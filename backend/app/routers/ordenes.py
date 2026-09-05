from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db
from datetime import datetime

router = APIRouter(prefix="/api", tags=["Ordenes y Transferencias"])

@router.post("/ordenes/confirmar-retiro")
def confirmar_retiro(request: schemas.ConfirmarRetiroRequest, db: Session = Depends(get_db)):
    """
    Valida el PIN y confirma el retiro de una orden Click & Collect.
    Descuenta definitivamente el stock y actualiza estados.
    """
    try:
        # Buscar orden con bloqueo pesimista
        orden = db.query(models.OrdenClickCollect).filter(
            models.OrdenClickCollect.id == request.orden_id
        ).with_for_update().first()
        
        if not orden:
            raise HTTPException(status_code=404, detail="Orden no encontrada")
            
        if orden.estado != "reservada" and orden.estado != "lista_retiro":
            raise HTTPException(status_code=409, detail=f"La orden está en estado {orden.estado} y no puede ser retirada")
            
        # Verificar PIN
        pin = db.query(models.PINRetiro).filter(
            models.PINRetiro.orden_id == orden.id
        ).with_for_update().first()
        
        if not pin or pin.codigo != request.pin:
            raise HTTPException(status_code=401, detail="PIN incorrecto")
            
        if pin.usado:
            raise HTTPException(status_code=409, detail="El PIN ya fue usado")
            
        if datetime.utcnow() > pin.expiracion:
            raise HTTPException(status_code=409, detail="El PIN y la reserva han expirado")
            
        # Procesar el retiro
        pin.usado = True
        orden.estado = "retirada"
        
        # Buscar las reservas de stock asociadas a esta orden
        reservas = db.query(models.ReservaStock).filter(
            models.ReservaStock.orden_id == orden.id,
            models.ReservaStock.estado == "pendiente"
        ).with_for_update().all()
        
        for reserva in reservas:
            reserva.estado = "confirmada"
            
            # Obtener el inventario
            inventario = db.query(models.InventarioSucursal).filter(
                models.InventarioSucursal.id == reserva.inventario_id
            ).with_for_update().first()
            
            # El stock_disponible ya fue restado al reservar,
            # ahora restamos del stock_reservado
            if inventario:
                inventario.stock_reservado -= reserva.cantidad
                
                # Registrar movimiento de salida final
                movimiento = models.MovimientoInventario(
                    inventario_id=inventario.id,
                    tipo="salida",
                    cantidad=reserva.cantidad,
                    motivo=f"Retiro de orden {orden.id}"
                )
                db.add(movimiento)
                
        db.commit()
        return {"mensaje": "Retiro confirmado exitosamente", "orden_id": orden.id}
        
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ordenes/{orden_id}", response_model=schemas.OrdenResponse)
def detalle_orden(orden_id: int, db: Session = Depends(get_db)):
    """Obtiene el detalle completo de una orden."""
    orden = db.query(models.OrdenClickCollect).filter(models.OrdenClickCollect.id == orden_id).first()
    if not orden:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return orden

@router.post("/transferencias")
def crear_transferencia(transferencia: schemas.TransferenciaRequest, db: Session = Depends(get_db)):
    """
    Crea una transferencia de stock entre dos sucursales.
    Verifica stock disponible en origen y lo descuenta.
    """
    if transferencia.sucursal_origen_id == transferencia.sucursal_destino_id:
        raise HTTPException(status_code=400, detail="Sucursal origen y destino no pueden ser la misma")
        
    if transferencia.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")
        
    try:
        # Verificar inventario origen con bloqueo pesimista
        inventario_origen = db.query(models.InventarioSucursal).filter(
            models.InventarioSucursal.sucursal_id == transferencia.sucursal_origen_id,
            models.InventarioSucursal.producto_id == transferencia.producto_id
        ).with_for_update().first()
        
        if not inventario_origen:
            raise HTTPException(status_code=404, detail="Inventario no encontrado en la sucursal de origen")
            
        if inventario_origen.stock_disponible < transferencia.cantidad:
            raise HTTPException(status_code=409, detail=f"Stock insuficiente en origen. Disponible: {inventario_origen.stock_disponible}")
            
        # Descontar stock de origen
        inventario_origen.stock_disponible -= transferencia.cantidad
        
        # Crear registro de transferencia
        nueva_transferencia = models.TransferenciaSucursal(
            sucursal_origen_id=transferencia.sucursal_origen_id,
            sucursal_destino_id=transferencia.sucursal_destino_id,
            producto_id=transferencia.producto_id,
            cantidad=transferencia.cantidad,
            estado="en_transito"
        )
        db.add(nueva_transferencia)
        
        # Registrar movimiento en origen
        movimiento = models.MovimientoInventario(
            inventario_id=inventario_origen.id,
            tipo="transferencia",
            cantidad=transferencia.cantidad,
            motivo=f"Transferencia hacia sucursal {transferencia.sucursal_destino_id}"
        )
        db.add(movimiento)
        
        db.commit()
        db.refresh(nueva_transferencia)
        
        return {
            "mensaje": "Transferencia iniciada con éxito",
            "transferencia_id": nueva_transferencia.id,
            "estado": nueva_transferencia.estado
        }
        
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
