# NexTech Hardware & Service — Plataforma de Inventario, Click & Collect y Asistente IA

> **Trabajo de Fin de Ciclo — Entrega Final**  
> **Curso de Inteligencia Artificial para Programadores**  
> **Universidad Tecnológica Nacional (UTN) · Facultad Regional Buenos Aires**  
> **Alumno:** Leonardo Cravero  

---

## 📌 Descripción del Proyecto
NexTech es una plataforma web integral diseñada para una red de 4 sucursales de hardware informático. Resuelve de raíz la fragmentación del stock físico, las sobreventas simultáneas en mostrador y web mediante **transacciones ACID con bloqueos pesimistas (`SELECT FOR UPDATE`)**, y ofrece un canal **Click & Collect con código PIN seguro de retiro** en 1 hora, asistido por un **agente inteligente en lenguaje natural** compatible con modelos locales (SLMs / Ollama).

---

## 🏗️ Arquitectura Técnica

El sistema se basa en una arquitectura monolítica modular en Python (FastAPI) con base de datos relacional y frontend SPA vanilla sin sobrecarga de dependencias:

* **Frontend:** HTML5 semántico, CSS3 moderno (Dark theme `#0F172A`, neon cyan y violet accents), JavaScript Vanilla (ES6+).
* **Backend:** FastAPI (Python 3.14) con Pydantic v2 y endpoints RESTful asíncronos.
* **Persistencia:** PostgreSQL / SQLite con transacciones atómicas gestionadas por SQLAlchemy.
* **Módulo de IA:** Pipeline de recomendación y consulta en lenguaje natural con validación determinística de stock en tiempo real (regla: *la IA recomienda, la base de datos valida*).
* **IA Local:** Compatible con Ollama y Small Language Models (Llama 3.2 1B / Phi-3 Mini) para inferencia 100% offline y costo cero por token.

---

## 🚀 Puesta en Marcha Rápida (Local)

### 1. Requisitos Previos
* Python 3.10 o superior
* Git
* *(Opcional)* Ollama instalado para inferencia local con SLMs

### 2. Instalación de Dependencias
```bash
cd backend
pip install -r requirements.txt
```

### 3. Iniciar el Servidor Backend
```bash
# Desde la carpeta backend:
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
* **API Base:** `http://127.0.0.1:8000`
* **Documentación Interactiva (Swagger UI):** `http://127.0.0.1:8000/docs`

### 4. Abrir la Aplicación Frontend
Abre el archivo `frontend/index.html` en cualquier navegador web o ejecuta:
```powershell
Start-Process "frontend/index.html"
```

---

## 📂 Estructura del Repositorio

```text
Proyecto/
├── INFORME_FINAL_ENTREGA.md       # Informe académico completo (UTN)
├── TP_Integrador_NexTech_v2.md    # Especificación de arquitectura y co-diseño
├── README.md                      # Documentación del repositorio
├── backend/                       # Servidor FastAPI
│   ├── app/
│   │   ├── main.py                # Configuración, CORS y seeder de base de datos
│   │   ├── database.py            # Motor SQLAlchemy y sesiones
│   │   ├── models.py              # Modelos ORM (Sucursales, Stock, Reservas, PINs)
│   │   ├── schemas.py             # Esquemas Pydantic
│   │   └── routers/
│   │       ├── inventario.py      # Endpoints de consulta de catálogo y stock
│   │       ├── reservas.py        # Reserva atómica con SELECT FOR UPDATE
│   │       ├── ordenes.py         # Confirmación de retiro con PIN y auditoría
│   │       └── asistente_ia.py    # Asistente inteligente en lenguaje natural
│   ├── db/schema.sql              # Script DDL SQL de inicialización
│   └── requirements.txt           # Dependencias de Python
└── frontend/                      # SPA Cliente
    ├── index.html                 # Vistas: Catálogo, Asistente IA, Reserva y Órdenes
    ├── style.css                  # Estilos visuales dark mode
    └── app.js                     # Lógica reactiva y conexión en vivo a la API
```

---

## 📄 Informe Completo de Entrega
Para consultar el informe académico detallado con la justificación de arquitectura, matriz de **Heurísticas de Nielsen**, **análisis de Ciberseguridad (OWASP)**, **reflexión de Co-work con IA** y la **Parte 2 sobre IA Local con Ollama**, ver el archivo [`INFORME_FINAL_ENTREGA.md`](INFORME_FINAL_ENTREGA.md).
