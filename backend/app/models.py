from sqlalchemy import Column, Integer, String, Boolean, Numeric, ForeignKey, DateTime, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class Rol(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(50), nullable=False) # admin|vendedor|tecnico|cliente
    permisos = Column(Text, nullable=True)

class Sucursal(Base):
    __tablename__ = "sucursales"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    direccion = Column(String(255), nullable=True)
    telefono = Column(String(50), nullable=True)
    activa = Column(Boolean, default=True)

class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    rol_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    sucursal_id = Column(Integer, ForeignKey("sucursales.id"), nullable=True)

class Producto(Base):
    __tablename__ = "productos"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(150), nullable=False)
    descripcion = Column(Text, nullable=True)
    categoria = Column(String(100), nullable=True)
    precio = Column(Numeric(10, 2), nullable=False)
    sku = Column(String(50), unique=True, nullable=False, index=True)
    activo = Column(Boolean, default=True)

class InventarioSucursal(Base):
    __tablename__ = "inventarios_sucursales"
    id = Column(Integer, primary_key=True, index=True)
    sucursal_id = Column(Integer, ForeignKey("sucursales.id"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    stock_disponible = Column(Integer, nullable=False, default=0)
    stock_reservado = Column(Integer, nullable=False, default=0)
    stock_minimo = Column(Integer, nullable=False, default=1)
    __table_args__ = (UniqueConstraint('sucursal_id', 'producto_id', name='uq_sucursal_producto'),)
    
    producto = relationship("Producto")
    sucursal = relationship("Sucursal")

class ReservaStock(Base):
    __tablename__ = "reservas_stock"
    id = Column(Integer, primary_key=True, index=True)
    inventario_id = Column(Integer, ForeignKey("inventarios_sucursales.id"), nullable=False)
    orden_id = Column(Integer, ForeignKey("ordenes_click_collect.id"), nullable=True)
    cantidad = Column(Integer, nullable=False)
    vencimiento = Column(DateTime, nullable=False)
    estado = Column(String(50), nullable=False) # pendiente|confirmada|vencida|cancelada

class MovimientoInventario(Base):
    __tablename__ = "movimientos_inventario"
    id = Column(Integer, primary_key=True, index=True)
    inventario_id = Column(Integer, ForeignKey("inventarios_sucursales.id"), nullable=False)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    tipo = Column(String(50), nullable=False) # entrada|salida|reserva|liberacion|transferencia|devolucion
    cantidad = Column(Integer, nullable=False)
    motivo = Column(Text, nullable=True)
    fecha = Column(DateTime, default=datetime.utcnow)

class TransferenciaSucursal(Base):
    __tablename__ = "transferencias_sucursales"
    id = Column(Integer, primary_key=True, index=True)
    sucursal_origen_id = Column(Integer, ForeignKey("sucursales.id"), nullable=False)
    sucursal_destino_id = Column(Integer, ForeignKey("sucursales.id"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    cantidad = Column(Integer, nullable=False)
    estado = Column(String(50), nullable=False) # solicitada|en_transito|completada|cancelada
    fecha_solicitud = Column(DateTime, default=datetime.utcnow)
    fecha_completada = Column(DateTime, nullable=True)

class OrdenClickCollect(Base):
    __tablename__ = "ordenes_click_collect"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True) # Puede ser anónimo temporalmente
    sucursal_id = Column(Integer, ForeignKey("sucursales.id"), nullable=False)
    total = Column(Numeric(10, 2), nullable=False)
    estado = Column(String(50), nullable=False) # pendiente|reservada|lista_retiro|retirada|cancelada|vencida
    fecha_creacion = Column(DateTime, default=datetime.utcnow)
    fecha_vencimiento = Column(DateTime, nullable=True)

    items = relationship("ItemOrden", back_populates="orden")
    pin_retiro = relationship("PINRetiro", back_populates="orden", uselist=False)

class ItemOrden(Base):
    __tablename__ = "items_orden"
    id = Column(Integer, primary_key=True, index=True)
    orden_id = Column(Integer, ForeignKey("ordenes_click_collect.id"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    cantidad = Column(Integer, nullable=False)
    precio_unitario = Column(Numeric(10, 2), nullable=False)

    orden = relationship("OrdenClickCollect", back_populates="items")
    producto = relationship("Producto")

class PINRetiro(Base):
    __tablename__ = "pines_retiro"
    id = Column(Integer, primary_key=True, index=True)
    orden_id = Column(Integer, ForeignKey("ordenes_click_collect.id"), unique=True, nullable=False)
    codigo = Column(String(6), nullable=False)
    usado = Column(Boolean, default=False)
    expiracion = Column(DateTime, nullable=False)

    orden = relationship("OrdenClickCollect", back_populates="pin_retiro")
