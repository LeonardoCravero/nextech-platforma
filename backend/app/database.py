import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Cargar variables de entorno desde el archivo .env si existe
load_dotenv()

# Obtener la URL de conexión a la base de datos de la variable de entorno,
# con soporte para nombres comunes de Render y limpieza automatica
DEFAULT_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "nextech.db"))
raw_db_url = (
    os.getenv("DATABASE_URL")
    or os.getenv("INTERNAL_DATABASE_URL")
    or os.getenv("POSTGRES_URL")
    or os.getenv("POSTGRESQL_URL")
    or os.getenv("DATABASE_URI")
    or os.getenv("DB_URL")
)

if raw_db_url and raw_db_url.strip():
    DATABASE_URL = raw_db_url.strip().strip("'").strip('"')
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
else:
    DATABASE_URL = f"sqlite:///{DEFAULT_DB_PATH}"

# Log para verificar en Render qué base de datos está activa
safe_url = DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL
print(f"\n==========================================")
print(f"--> [DATABASE ENGINE] Conectado a: {safe_url}")
print(f"==========================================\n")

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
