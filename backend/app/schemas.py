from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime
from decimal import Decimal

# --- SUCURSALES ---
class SucursalBase(BaseModel):
    nombre: str
    direccion: Optional[str] = None
    telefono: Optional[str] = None
    activa: bool = True

class Sucursal(SucursalBase):
    id: int
    class Config:
        from_attributes = True

# --- PRODUCTOS ---
class ProductoBase(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    categoria: Optional[str] = None
    precio: Decimal
    sku: str
    activo: bool = True

class Producto(ProductoBase):
    id: int
    class Config:
        from_attributes = True

# --- INVENTARIO ---
class InventarioSucursalBase(BaseModel):
    sucursal_id: int
    producto_id: int
    stock_disponible: int
    stock_reservado: int
    stock_minimo: int

class InventarioSucursal(InventarioSucursalBase):
    id: int
    class Config:
        from_attributes = True

class StockDetalle(BaseModel):
    sucursal_id: int
    sucursal_nombre: str
    producto_id: int
    producto_nombre: str
    stock_disponible: int
    stock_reservado: int

# --- RESERVAS ---
class ItemReservaCreate(BaseModel):
    producto_id: int
    cantidad: int

class ReservaCreate(BaseModel):
    sucursal_id: int
    items: List[ItemReservaCreate]
    usuario_email: Optional[EmailStr] = None

class ReservaResponse(BaseModel):
    orden_id: int
    pin: str
    vencimiento: datetime

# --- ORDENES ---
class ItemOrdenSchema(BaseModel):
    producto_id: int
    cantidad: int
    precio_unitario: Decimal
    class Config:
        from_attributes = True

class OrdenResponse(BaseModel):
    id: int
    sucursal_id: int
    total: Decimal
    estado: str
    fecha_creacion: datetime
    fecha_vencimiento: Optional[datetime]
    items: List[ItemOrdenSchema]
    class Config:
        from_attributes = True

class ConfirmarRetiroRequest(BaseModel):
    orden_id: int
    pin: str

class TransferenciaRequest(BaseModel):
    sucursal_origen_id: int
    sucursal_destino_id: int
    producto_id: int
    cantidad: int
