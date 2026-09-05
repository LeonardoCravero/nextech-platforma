import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Cargar variables de entorno desde el archivo .env si existe
load_dotenv()

# Obtener la URL de conexión a la base de datos de la variable de entorno,
# con SQLite local por defecto para desarrollo inmediato si no se especifica DATABASE_URL
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./nextech.db")

# Crear el motor de SQLAlchemy adaptado al motor configurado
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

# Crear la clase SessionLocal para manejar las sesiones de la base de datos
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base para definir los modelos ORM
Base = declarative_base()

# Dependencia para obtener la sesión de la base de datos en los endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
