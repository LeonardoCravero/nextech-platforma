from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .routers import inventario, reservas, ordenes, asistente_ia
import logging
from sqlalchemy.orm import Session
from .database import SessionLocal
from . import models

# Crear las tablas en la base de datos
Base.metadata.create_all(bind=engine)

app = FastAPI(title="NexTech MVP1 API", version="1.0.0")

# Configurar CORS para permitir todos los orígenes en desarrollo local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir los routers
app.include_router(inventario.router)
app.include_router(reservas.router)
app.include_router(ordenes.router)
app.include_router(asistente_ia.router)

def seed_db():
    """Función para poblar la base de datos con datos de prueba si está vacía."""
    db = SessionLocal()
    try:
        # Si ya hay sucursales, asumimos que ya hay datos
        if db.query(models.Sucursal).first():
            return

        print("Poblando base de datos con datos de prueba...")
        
        # 1. Crear sucursales
        sucursales_data = [
            {"nombre": "Central Obelisco", "direccion": "Av. Corrientes 1000, CABA", "telefono": "11-4555-0001"},
            {"nombre": "Palermo Soho", "direccion": "Honduras 5000, CABA", "telefono": "11-4555-0002"},
            {"nombre": "Belgrano Tech", "direccion": "Cabildo 2000, CABA", "telefono": "11-4555-0003"},
            {"nombre": "Zona Norte Martínez", "direccion": "Av. Santa Fe 1500, Martínez", "telefono": "11-4555-0004"}
        ]
        sucursales = []
        for s in sucursales_data:
            suc = models.Sucursal(**s)
            db.add(suc)
            sucursales.append(suc)
        db.commit()

        # 2. Crear roles
        roles_data = ["admin", "vendedor", "tecnico", "cliente"]
        for r in roles_data:
            db.add(models.Rol(nombre=r))
        db.commit()

        # 3. Crear productos (Hardware)
        productos_data = [
            {"nombre": "Notebook Dell XPS 15", "descripcion": "Intel Core i9, 32GB RAM, 1TB SSD", "categoria": "Laptops", "precio": 2500.00, "sku": "NB-DELL-XPS15"},
            {"nombre": "Notebook ThinkPad T14", "descripcion": "AMD Ryzen 7, 16GB RAM, 512GB SSD", "categoria": "Laptops", "precio": 1400.00, "sku": "NB-LEN-T14"},
            {"nombre": "Monitor LG UltraWide 34\"", "descripcion": "Monitor curvo 34 pulgadas 144Hz", "categoria": "Monitores", "precio": 850.00, "sku": "MON-LG-34UW"},
            {"nombre": "Teclado Mecánico Keychron K2", "descripcion": "Teclado mecánico wireless Gateron Brown", "categoria": "Periféricos", "precio": 120.00, "sku": "PER-KEY-K2"},
            {"nombre": "Mouse Logitech MX Master 3S", "descripcion": "Mouse ergonómico inalámbrico", "categoria": "Periféricos", "precio": 100.00, "sku": "PER-LOG-MX3S"},
            {"nombre": "Auriculares Sony WH-1000XM5", "descripcion": "Auriculares con cancelación de ruido", "categoria": "Audio", "precio": 350.00, "sku": "AUD-SONY-XM5"},
            {"nombre": "Disco SSD Samsung 980 Pro 2TB", "descripcion": "SSD NVMe M.2 2TB PCIe 4.0", "categoria": "Almacenamiento", "precio": 200.00, "sku": "STO-SAM-980P2T"},
            {"nombre": "Memoria RAM Corsair Vengeance 32GB", "descripcion": "DDR5 5600MHz 2x16GB", "categoria": "Componentes", "precio": 150.00, "sku": "COM-COR-32DDR5"}
        ]
        productos = []
        for p in productos_data:
            prod = models.Producto(**p)
            db.add(prod)
            productos.append(prod)
        db.commit()

        # 4. Crear inventario (Asignar stock aleatorio a cada sucursal para cada producto)
        import random
        for suc in db.query(models.Sucursal).all():
            for prod in db.query(models.Producto).all():
                stock = random.randint(5, 50)
                inv = models.InventarioSucursal(
                    sucursal_id=suc.id,
                    producto_id=prod.id,
                    stock_disponible=stock,
                    stock_reservado=0,
                    stock_minimo=5
                )
                db.add(inv)
        db.commit()
        print("Datos de prueba insertados correctamente.")

    except Exception as e:
        print(f"Error poblando DB: {e}")
        db.rollback()
    finally:
        db.close()

@app.on_event("startup")
def startup_event():
    # Ejecutar seeder en el arranque
    seed_db()

@app.get("/")
def root():
    return {"message": "Bienvenido a la API de NexTech MVP1", "docs": "/docs"}
