from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db
from ..auth import require_role, get_current_user
from datetime import datetime
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["Ordenes y Transferencias"])


# --- Schemas locales ----------------------------------------------------------

class RetirarRequest(BaseModel):
    pin: str

class CancelarRequest(BaseModel):
    pin: str


# --- EMPLEADO: confirmar retiro con PIN del cliente ---------------------------

@router.post("/ordenes/{orden_id}/retirar", dependencies=[Depends(require_role("empleado"))])
def retirar_orden(orden_id: int, request: RetirarRequest, db: Session = Depends(get_db)):
    """(Solo empleado) Valida el PIN y marca la orden como retirada."""
    try:
        orden = db.query(models.OrdenClickCollect).filter(
            models.OrdenClickCollect.id == orden_id
        ).with_for_update().first()

        if not orden:
            raise HTTPException(status_code=404, detail="Orden no encontrada")

        if orden.estado not in ("reservada", "lista_retiro"):
            raise HTTPException(status_code=409, detail=f"La orden esta en estado '{orden.estado}' y no puede ser retirada")

        pin = db.query(models.PINRetiro).filter(
            models.PINRetiro.orden_id == orden.id
        ).with_for_update().first()

        if not pin or pin.codigo != request.pin:
            raise HTTPException(status_code=401, detail="PIN incorrecto")
        if pin.usado:
            raise HTTPException(status_code=409, detail="El PIN ya fue usado")
        if datetime.utcnow() > pin.expiracion:
            raise HTTPException(status_code=409, detail="El PIN y la reserva han expirado")

        pin.usado = True
        orden.estado = "retirada"

        reservas = db.query(models.ReservaStock).filter(
            models.ReservaStock.orden_id == orden.id,
            models.ReservaStock.estado == "pendiente"
        ).with_for_update().all()

        for reserva in reservas:
            reserva.estado = "confirmada"
            inventario = db.query(models.InventarioSucursal).filter(
                models.InventarioSucursal.id == reserva.inventario_id
            ).with_for_update().first()
            if inventario:
                inventario.stock_reservado -= reserva.cantidad
                db.add(models.MovimientoInventario(
                    inventario_id=inventario.id, tipo="salida",
                    cantidad=reserva.cantidad, motivo=f"Retiro de orden {orden.id}"
                ))

        db.commit()
        return {"mensaje": "Retiro confirmado exitosamente", "orden_id": orden.id}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# --- CLIENTE: cancelar su propia reserva con su PIN --------------------------

@router.post("/ordenes/{orden_id}/cancelar", dependencies=[Depends(require_role("cliente"))])
def cancelar_orden(
    orden_id: int,
    request: CancelarRequest,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    """(Solo cliente) Cancela su propia reserva usando el PIN."""
    try:
        orden = db.query(models.OrdenClickCollect).filter(
            models.OrdenClickCollect.id == orden_id
        ).with_for_update().first()

        if not orden:
            raise HTTPException(status_code=404, detail="Orden no encontrada")
        if orden.usuario_id != current_user.id:
            raise HTTPException(status_code=403, detail="No tenes permiso para cancelar esta orden")
        if orden.estado not in ("reservada", "lista_retiro"):
            raise HTTPException(status_code=409, detail=f"La orden esta en estado '{orden.estado}' y no puede cancelarse")

        pin = db.query(models.PINRetiro).filter(
            models.PINRetiro.orden_id == orden.id
        ).with_for_update().first()

        if not pin or pin.codigo != request.pin:
            raise HTTPException(status_code=401, detail="PIN incorrecto")
        if pin.usado:
            raise HTTPException(status_code=409, detail="El PIN ya fue usado")

        pin.usado = True
        orden.estado = "cancelada"

        reservas = db.query(models.ReservaStock).filter(
            models.ReservaStock.orden_id == orden.id,
            models.ReservaStock.estado == "pendiente"
        ).with_for_update().all()

        for reserva in reservas:
            reserva.estado = "cancelada"
            inventario = db.query(models.InventarioSucursal).filter(
                models.InventarioSucursal.id == reserva.inventario_id
            ).with_for_update().first()
            if inventario:
                inventario.stock_disponible += reserva.cantidad
                inventario.stock_reservado -= reserva.cantidad
                db.add(models.MovimientoInventario(
                    inventario_id=inventario.id, tipo="liberacion",
                    cantidad=reserva.cantidad, motivo=f"Cancelacion de orden {orden.id} por el cliente"
                ))

        db.commit()
        return {"mensaje": "Reserva cancelada exitosamente", "orden_id": orden.id}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# --- GET detalle de orden -----------------------------------------------------

@router.get("/ordenes/{orden_id}", response_model=schemas.OrdenResponse)
def detalle_orden(orden_id: int, db: Session = Depends(get_db)):
    """Obtiene el detalle completo de una orden."""
    orden = db.query(models.OrdenClickCollect).filter(
        models.OrdenClickCollect.id == orden_id
    ).first()
    if not orden:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return orden


# --- GET todas las ordenes (solo empleado) ------------------------------------

@router.get("/ordenes", dependencies=[Depends(require_role("empleado"))])
def listar_ordenes(db: Session = Depends(get_db)):
    """(Solo empleado) Lista todas las ordenes."""
    ordenes = db.query(models.OrdenClickCollect).order_by(
        models.OrdenClickCollect.fecha_creacion.desc()
    ).all()
    result = []
    for o in ordenes:
        result.append({
            "id": o.id,
            "usuario_id": o.usuario_id,
            "sucursal_id": o.sucursal_id,
            "total": float(o.total),
            "estado": o.estado,
            "fecha_creacion": o.fecha_creacion.isoformat() if o.fecha_creacion else None,
            "fecha_vencimiento": o.fecha_vencimiento.isoformat() if o.fecha_vencimiento else None,
            "pin": o.pin_retiro.codigo if o.pin_retiro else None,
            "items": [
                {"producto_id": item.producto_id,
                 "nombre": item.producto.nombre if item.producto else None,
                 "cantidad": item.cantidad,
                 "precio_unitario": float(item.precio_unitario)}
                for item in o.items
            ]
        })
    return result


# --- GET mis ordenes (solo cliente) ------------------------------------------

@router.get("/mis-ordenes", dependencies=[Depends(require_role("cliente"))])
def mis_ordenes(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    """(Solo cliente) Retorna las ordenes del usuario autenticado."""
    ordenes = db.query(models.OrdenClickCollect).filter(
        models.OrdenClickCollect.usuario_id == current_user.id
    ).order_by(models.OrdenClickCollect.fecha_creacion.desc()).all()

    result = []
    for o in ordenes:
        result.append({
            "id": o.id,
            "sucursal_id": o.sucursal_id,
            "total": float(o.total),
            "estado": o.estado,
            "fecha_creacion": o.fecha_creacion.isoformat() if o.fecha_creacion else None,
            "fecha_vencimiento": o.fecha_vencimiento.isoformat() if o.fecha_vencimiento else None,
            "pin": o.pin_retiro.codigo if o.pin_retiro else None,
            "items": [
                {"producto_id": item.producto_id,
                 "nombre": item.producto.nombre if item.producto else None,
                 "cantidad": item.cantidad,
                 "precio_unitario": float(item.precio_unitario)}
                for item in o.items
            ]
        })
    return result


# --- Transferencias -----------------------------------------------------------

@router.post("/transferencias")
def crear_transferencia(transferencia: schemas.TransferenciaRequest, db: Session = Depends(get_db)):
    """Crea una transferencia de stock entre dos sucursales."""
    if transferencia.sucursal_origen_id == transferencia.sucursal_destino_id:
        raise HTTPException(status_code=400, detail="Sucursal origen y destino no pueden ser la misma")
    if transferencia.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")

    try:
        inventario_origen = db.query(models.InventarioSucursal).filter(
            models.InventarioSucursal.sucursal_id == transferencia.sucursal_origen_id,
            models.InventarioSucursal.producto_id == transferencia.producto_id
        ).with_for_update().first()

        if not inventario_origen:
            raise HTTPException(status_code=404, detail="Inventario no encontrado en la sucursal de origen")
        if inventario_origen.stock_disponible < transferencia.cantidad:
            raise HTTPException(status_code=409, detail=f"Stock insuficiente en origen. Disponible: {inventario_origen.stock_disponible}")

        inventario_origen.stock_disponible -= transferencia.cantidad

        nueva_transferencia = models.TransferenciaSucursal(
            sucursal_origen_id=transferencia.sucursal_origen_id,
            sucursal_destino_id=transferencia.sucursal_destino_id,
            producto_id=transferencia.producto_id,
            cantidad=transferencia.cantidad,
            estado="en_transito"
        )
        db.add(nueva_transferencia)
        db.add(models.MovimientoInventario(
            inventario_id=inventario_origen.id,
            tipo="transferencia",
            cantidad=transferencia.cantidad,
            motivo=f"Transferencia hacia sucursal {transferencia.sucursal_destino_id}"
        ))

        db.commit()
        db.refresh(nueva_transferencia)

        return {
            "mensaje": "Transferencia iniciada con exito",
            "transferencia_id": nueva_transferencia.id,
            "estado": nueva_transferencia.estado
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
