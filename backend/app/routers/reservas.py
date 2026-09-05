from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime, timedelta
import random
import string
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/reservas", tags=["Reservas"])

def generar_pin(length: int = 6) -> str:
    """Genera un PIN alfanumérico aleatorio."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

@router.post("", response_model=schemas.ReservaResponse)
def crear_reserva(reserva: schemas.ReservaCreate, db: Session = Depends(get_db)):
    """
    Crea una reserva atómica. Verifica stock disponible con SELECT FOR UPDATE.
    Si no hay stock de algún producto, revierte la operación y retorna 409.
    """
    if not reserva.items:
        raise HTTPException(status_code=422, detail="La reserva debe contener al menos un producto")

    try:
        total_orden = 0
        items_procesados = []
        
        # Iniciar transacción bloqueando los registros de inventario necesarios
        for item in reserva.items:
            # Buscar el inventario con bloqueo pesimista
            inventario = db.query(models.InventarioSucursal).filter(
                models.InventarioSucursal.sucursal_id == reserva.sucursal_id,
                models.InventarioSucursal.producto_id == item.producto_id
            ).with_for_update().first()
            
            if not inventario:
                db.rollback()
                raise HTTPException(status_code=404, detail=f"Inventario no encontrado para el producto {item.producto_id}")
                
            if inventario.stock_disponible < item.cantidad:
                db.rollback()
                raise HTTPException(status_code=409, detail=f"Stock insuficiente para el producto {item.producto_id}. Disponible: {inventario.stock_disponible}")
                
            # Buscar el producto para obtener el precio
            producto = db.query(models.Producto).filter(models.Producto.id == item.producto_id).first()
            if not producto:
                db.rollback()
                raise HTTPException(status_code=404, detail=f"Producto {item.producto_id} no encontrado")
                
            # Actualizar stocks en memoria
            inventario.stock_disponible -= item.cantidad
            inventario.stock_reservado += item.cantidad
            
            total_orden += producto.precio * item.cantidad
            
            items_procesados.append({
                "inventario_id": inventario.id,
                "producto_id": producto.id,
                "cantidad": item.cantidad,
                "precio": producto.precio
            })
            
        # Crear la orden Click & Collect
        vencimiento = datetime.utcnow() + timedelta(hours=24)
        
        # Opcional: Buscar usuario si se provee email
        usuario_id = None
        if reserva.usuario_email:
            usuario = db.query(models.Usuario).filter(models.Usuario.email == reserva.usuario_email).first()
            if usuario:
                usuario_id = usuario.id
                
        nueva_orden = models.OrdenClickCollect(
            usuario_id=usuario_id,
            sucursal_id=reserva.sucursal_id,
            total=total_orden,
            estado="reservada",
            fecha_vencimiento=vencimiento
        )
        db.add(nueva_orden)
        db.flush() # Para obtener el ID de la orden
        
        # Generar PIN de retiro
        pin = generar_pin()
        nuevo_pin = models.PINRetiro(
            orden_id=nueva_orden.id,
            codigo=pin,
            expiracion=vencimiento
        )
        db.add(nuevo_pin)
        
        # Crear los ítems de la orden y reservas de stock
        for item_data in items_procesados:
            item_orden = models.ItemOrden(
                orden_id=nueva_orden.id,
                producto_id=item_data["producto_id"],
                cantidad=item_data["cantidad"],
                precio_unitario=item_data["precio"]
            )
            db.add(item_orden)
            
            reserva_stock = models.ReservaStock(
                inventario_id=item_data["inventario_id"],
                orden_id=nueva_orden.id,
                cantidad=item_data["cantidad"],
                vencimiento=vencimiento,
                estado="pendiente"
            )
            db.add(reserva_stock)
            
            # Registrar el movimiento de inventario de reserva
            movimiento = models.MovimientoInventario(
                inventario_id=item_data["inventario_id"],
                tipo="reserva",
                cantidad=item_data["cantidad"],
                motivo=f"Reserva para orden {nueva_orden.id}"
            )
            db.add(movimiento)
            
        # Confirmar toda la transacción
        db.commit()
        
        return schemas.ReservaResponse(
            orden_id=nueva_orden.id,
            pin=pin,
            vencimiento=vencimiento
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{orden_id}", response_model=schemas.OrdenResponse)
def estado_reserva(orden_id: int, db: Session = Depends(get_db)):
    """Obtiene el estado de una reserva por su ID de orden."""
    orden = db.query(models.OrdenClickCollect).filter(models.OrdenClickCollect.id == orden_id).first()
    if not orden:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return orden
