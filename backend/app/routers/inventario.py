from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api", tags=["Inventario"])

@router.get("/sucursales", response_model=List[schemas.Sucursal])
def listar_sucursales(db: Session = Depends(get_db)):
    """Lista todas las sucursales activas."""
    return db.query(models.Sucursal).filter(models.Sucursal.activa == True).all()

@router.get("/productos", response_model=List[schemas.Producto])
def listar_productos(db: Session = Depends(get_db)):
    """Lista todos los productos activos."""
    return db.query(models.Producto).filter(models.Producto.activo == True).all()

@router.get("/stock", response_model=List[schemas.StockDetalle])
def listar_stock(
    sucursal_id: Optional[int] = Query(None, description="Filtrar por ID de sucursal"),
    producto_id: Optional[int] = Query(None, description="Filtrar por ID de producto"),
    db: Session = Depends(get_db)
):
    """Lista el stock de todas las sucursales. Permite filtrar por sucursal y producto."""
    query = db.query(
        models.InventarioSucursal.sucursal_id,
        models.Sucursal.nombre.label("sucursal_nombre"),
        models.InventarioSucursal.producto_id,
        models.Producto.nombre.label("producto_nombre"),
        models.InventarioSucursal.stock_disponible,
        models.InventarioSucursal.stock_reservado
    ).join(models.Sucursal).join(models.Producto)
    
    if sucursal_id:
        query = query.filter(models.InventarioSucursal.sucursal_id == sucursal_id)
    if producto_id:
        query = query.filter(models.InventarioSucursal.producto_id == producto_id)
        
    resultados = query.all()
    
    return [
        schemas.StockDetalle(
            sucursal_id=r.sucursal_id,
            sucursal_nombre=r.sucursal_nombre,
            producto_id=r.producto_id,
            producto_nombre=r.producto_nombre,
            stock_disponible=r.stock_disponible,
            stock_reservado=r.stock_reservado
        ) for r in resultados
    ]

@router.get("/stock/{sucursal_id}/{producto_id}", response_model=schemas.InventarioSucursal)
def obtener_stock_especifico(sucursal_id: int, producto_id: int, db: Session = Depends(get_db)):
    """Obtiene el stock específico de un producto en una sucursal."""
    stock = db.query(models.InventarioSucursal).filter(
        models.InventarioSucursal.sucursal_id == sucursal_id,
        models.InventarioSucursal.producto_id == producto_id
    ).first()
    
    if not stock:
        raise HTTPException(status_code=404, detail="Stock no encontrado para la sucursal y producto especificados")
        
    return stock
