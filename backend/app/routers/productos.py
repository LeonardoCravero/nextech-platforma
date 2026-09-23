from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from .. import models
from ..database import get_db
from ..auth import require_role

router = APIRouter(prefix="/api", tags=["Productos (Empleado)"])


# --- Schemas locales ----------------------------------------------------------

class StockSucursal(BaseModel):
    sucursal_id: int
    stock_inicial: int = 0
    stock_minimo: int = 2

class ProductoCreate(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    categoria: Optional[str] = None
    precio: float
    sku: str
    # Optional: specify initial stock per branch. Branches not listed get stock=0.
    # If omitted entirely, all active branches start with stock=0.
    stock_por_sucursal: Optional[list[StockSucursal]] = None

class ProductoUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    categoria: Optional[str] = None
    precio: Optional[float] = None
    activo: Optional[bool] = None

class StockUpdate(BaseModel):
    stock_disponible: int
    stock_minimo: Optional[int] = None

class InventarioCreate(BaseModel):
    producto_id: int
    sucursal_id: int
    stock_disponible: int
    stock_minimo: Optional[int] = 2


# --- GET inventario completo (empleado) ---------------------------------------

@router.get("/inventario", dependencies=[Depends(require_role("empleado"))])
def get_inventario(sucursal_id: Optional[int] = None, db: Session = Depends(get_db)):
    """(Solo empleado) Lista todo el inventario con detalles de producto y sucursal. Permite filtrar por sucursal."""
    query = db.query(models.InventarioSucursal)
    if sucursal_id:
        query = query.filter(models.InventarioSucursal.sucursal_id == sucursal_id)
    items = query.all()
    result = []
    for item in items:
        result.append({
            "inventario_id": item.id,
            "sucursal_id": item.sucursal_id,
            "sucursal_nombre": item.sucursal.nombre if item.sucursal else None,
            "producto_id": item.producto_id,
            "producto_nombre": item.producto.nombre if item.producto else None,
            "sku": item.producto.sku if item.producto else None,
            "categoria": item.producto.categoria if item.producto else None,
            "precio": float(item.producto.precio) if item.producto else None,
            "stock_disponible": item.stock_disponible,
            "stock_reservado": item.stock_reservado,
            "stock_minimo": item.stock_minimo,
        })
    return result


# --- POST crear producto (empleado) ------------------------------------------

@router.post("/productos", dependencies=[Depends(require_role("empleado"))], status_code=201)
def crear_producto(data: ProductoCreate, db: Session = Depends(get_db)):
    """(Solo empleado) Crea un nuevo producto."""
    if db.query(models.Producto).filter(models.Producto.sku == data.sku).first():
        raise HTTPException(status_code=400, detail="Ya existe un producto con ese SKU")

    producto = models.Producto(
        nombre=data.nombre,
        descripcion=data.descripcion,
        categoria=data.categoria,
        precio=data.precio,
        sku=data.sku,
        activo=True
    )
    db.add(producto)
    db.flush()

    # Inicializar inventario ÚNICAMENTE en las sucursales donde se haya asignado stock
    if data.stock_por_sucursal:
        for entrada in data.stock_por_sucursal:
            if entrada.stock_inicial > 0:
                inv = models.InventarioSucursal(
                    sucursal_id=entrada.sucursal_id,
                    producto_id=producto.id,
                    stock_disponible=entrada.stock_inicial,
                    stock_reservado=0,
                    stock_minimo=entrada.stock_minimo
                )
                db.add(inv)

    db.commit()
    db.refresh(producto)
    return {
        "id": producto.id,
        "nombre": producto.nombre,
        "descripcion": producto.descripcion,
        "categoria": producto.categoria,
        "precio": float(producto.precio),
        "sku": producto.sku,
        "activo": producto.activo,
    }


# --- PUT editar producto (empleado) ------------------------------------------

@router.put("/productos/{producto_id}", dependencies=[Depends(require_role("empleado"))])
def editar_producto(producto_id: int, data: ProductoUpdate, db: Session = Depends(get_db)):
    """(Solo empleado) Edita un producto existente."""
    producto = db.query(models.Producto).filter(models.Producto.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    if data.nombre is not None:
        producto.nombre = data.nombre
    if data.descripcion is not None:
        producto.descripcion = data.descripcion
    if data.categoria is not None:
        producto.categoria = data.categoria
    if data.precio is not None:
        producto.precio = data.precio
    if data.activo is not None:
        producto.activo = data.activo

    db.commit()
    db.refresh(producto)
    return {
        "id": producto.id,
        "nombre": producto.nombre,
        "descripcion": producto.descripcion,
        "categoria": producto.categoria,
        "precio": float(producto.precio),
        "sku": producto.sku,
        "activo": producto.activo,
    }


# --- DELETE eliminar producto (empleado) -------------------------------------

@router.delete("/productos/{producto_id}", dependencies=[Depends(require_role("empleado"))])
def eliminar_producto(producto_id: int, db: Session = Depends(get_db)):
    """(Solo empleado) Elimina (desactiva) un producto."""
    producto = db.query(models.Producto).filter(models.Producto.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    # Soft delete: marcar como inactivo en lugar de borrar fisicamente
    producto.activo = False
    db.commit()
    return {"mensaje": f"Producto {producto_id} eliminado correctamente"}


# --- PUT ajustar stock de una sucursal (empleado) ----------------------------

@router.put("/inventario/{inventario_id}", dependencies=[Depends(require_role("empleado"))])
def ajustar_stock(inventario_id: int, data: StockUpdate, db: Session = Depends(get_db)):
    """(Solo empleado) Ajusta el stock disponible y el mínimo de una fila de
    inventario (combinación producto × sucursal)."""
    item = db.query(models.InventarioSucursal).filter(
        models.InventarioSucursal.id == inventario_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Entrada de inventario no encontrada")

    if data.stock_disponible < 0:
        raise HTTPException(status_code=400, detail="El stock no puede ser negativo")

    item.stock_disponible = data.stock_disponible
    if data.stock_minimo is not None:
        item.stock_minimo = data.stock_minimo

    db.commit()
    db.refresh(item)
    return {
        "inventario_id": item.id,
        "sucursal_id": item.sucursal_id,
        "producto_id": item.producto_id,
        "stock_disponible": item.stock_disponible,
        "stock_reservado": item.stock_reservado,
        "stock_minimo": item.stock_minimo,
    }


# --- POST agregar producto a sucursal (empleado) -----------------------------

@router.post("/inventario", dependencies=[Depends(require_role("empleado"))], status_code=201)
def asignar_stock_sucursal(data: InventarioCreate, db: Session = Depends(get_db)):
    """(Solo empleado) Asigna o agrega un producto al inventario de una sucursal."""
    if data.stock_disponible < 0:
        raise HTTPException(status_code=400, detail="El stock no puede ser negativo")

    existente = db.query(models.InventarioSucursal).filter(
        models.InventarioSucursal.producto_id == data.producto_id,
        models.InventarioSucursal.sucursal_id == data.sucursal_id
    ).first()

    if existente:
        existente.stock_disponible = data.stock_disponible
        if data.stock_minimo is not None:
            existente.stock_minimo = data.stock_minimo
        db.commit()
        db.refresh(existente)
        return {
            "inventario_id": existente.id,
            "sucursal_id": existente.sucursal_id,
            "producto_id": existente.producto_id,
            "stock_disponible": existente.stock_disponible,
            "stock_reservado": existente.stock_reservado,
            "stock_minimo": existente.stock_minimo,
        }

    nuevo = models.InventarioSucursal(
        producto_id=data.producto_id,
        sucursal_id=data.sucursal_id,
        stock_disponible=data.stock_disponible,
        stock_reservado=0,
        stock_minimo=data.stock_minimo or 2
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return {
        "inventario_id": nuevo.id,
        "sucursal_id": nuevo.sucursal_id,
        "producto_id": nuevo.producto_id,
        "stock_disponible": nuevo.stock_disponible,
        "stock_reservado": nuevo.stock_reservado,
        "stock_minimo": nuevo.stock_minimo,
    }


# --- DELETE quitar producto de sucursal (empleado) ---------------------------

@router.delete("/inventario/{inventario_id}", dependencies=[Depends(require_role("empleado"))])
def eliminar_inventario_sucursal(inventario_id: int, db: Session = Depends(get_db)):
    """(Solo empleado) Quita el producto del inventario de una sucursal específica."""
    item = db.query(models.InventarioSucursal).filter(
        models.InventarioSucursal.id == inventario_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Entrada de inventario no encontrada")

    if item.stock_reservado > 0:
        raise HTTPException(
            status_code=400,
            detail="No se puede quitar: existen reservas pendientes de retiro en esta sucursal"
        )

    db.delete(item)
    db.commit()
    return {"mensaje": "Producto quitado de la sucursal correctamente"}


