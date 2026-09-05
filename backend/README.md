# NexTech MVP1 - Backend

Backend desarrollado en **FastAPI (Python)** y **PostgreSQL**, enfocado en la gestión de inventarios multi-sucursal, reservas atómicas para retiros Click & Collect y transferencias.

## 1. Requisitos
- Python 3.10 o superior
- PostgreSQL (Base de datos local o remota)

## 2. Instalación
Ubícate en la carpeta del backend y ejecuta los siguientes comandos para instalar las dependencias:

```bash
# Crear un entorno virtual (opcional pero recomendado)
python -m venv venv

# Activar el entorno virtual (Windows)
venv\Scripts\activate

# Instalar los requerimientos
pip install -r requirements.txt
```

## 3. Configuración de variables de entorno
Crea un archivo llamado `.env` en la raíz de la carpeta `backend` o define la variable de entorno en tu sistema:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nextech
```
Ajusta el usuario, contraseña, host y nombre de la base de datos según tu configuración de PostgreSQL.

## 4. Cómo crear la base de datos
Debes tener una base de datos creada en tu servidor PostgreSQL llamada `nextech` (o el nombre que hayas configurado en el `.env`).

El sistema utiliza **SQLAlchemy** para crear las tablas automáticamente al arrancar. Adicionalmente, incluye una función de *seed* que poblara la base de datos con 4 sucursales, 8 productos y stock inicial para todos si detecta que la base está vacía.

Si deseas inicializar la base de datos de manera manual y ver exactamente la estructura, puedes ejecutar el script SQL proporcionado:
```bash
# Ejecutar desde línea de comandos usando psql (Ajusta los parámetros según tu entorno)
psql -U postgres -d nextech -f db/schema.sql
```

## 5. Cómo correr el servidor
Para iniciar el servidor de desarrollo, ejecuta el siguiente comando:

```bash
uvicorn app.main:app --reload
```
La API estará disponible en `http://localhost:8000`. 
Puedes ver la documentación interactiva (Swagger UI) en `http://localhost:8000/docs`.

## 6. Ejemplos de uso de la API con curl

### Listar sucursales
```bash
curl -X GET "http://localhost:8000/api/sucursales"
```

### Consultar stock de todos los productos en una sucursal (ej: id 1)
```bash
curl -X GET "http://localhost:8000/api/stock?sucursal_id=1"
```

### Crear una reserva (Click & Collect)
```bash
curl -X POST "http://localhost:8000/api/reservas" \
     -H "Content-Type: application/json" \
     -d '{
           "sucursal_id": 1,
           "items": [
             {
               "producto_id": 1,
               "cantidad": 1
             }
           ]
         }'
```
*Guarda el `orden_id` y el `pin` que devuelve esta solicitud para el siguiente paso.*

### Confirmar el retiro de la reserva
*(Reemplaza el orden_id y el pin)*
```bash
curl -X POST "http://localhost:8000/api/ordenes/confirmar-retiro" \
     -H "Content-Type: application/json" \
     -d '{
           "orden_id": 1,
           "pin": "A1B2C3"
         }'
```

### Iniciar una transferencia entre sucursales
```bash
curl -X POST "http://localhost:8000/api/transferencias" \
     -H "Content-Type: application/json" \
     -d '{
           "sucursal_origen_id": 1,
           "sucursal_destino_id": 2,
           "producto_id": 1,
           "cantidad": 2
         }'
```
