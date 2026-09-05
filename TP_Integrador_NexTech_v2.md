# TP Integrador 1 — NexTech Platform

| Campo | Detalle |
| :--- | :--- |
| **Materia** | Inteligencia Artificial para Programadores |
| **Unidad** | TP Integrador 1 |
| **Alumno** | Leonardo Cravero |
| **Caso de estudio** | NexTech Hardware & Service |
| **Herramientas utilizadas** | ChatGPT/LLM (arquitectura), Mermaid-IA (UML), Midjourney (exploración visual), Figma AI (wireframes), FastAPI + PostgreSQL (prototipo). |

## Introducción
El presente trabajo refleja un proceso integral de co-diseño con Inteligencia Artificial desarrollado a lo largo de cuatro actividades. Desde la definición conceptual de una problemática operativa hasta la materialización de un MVP, la IA funcionó como un par consultivo para refinar el modelo de datos, contrastar arquitecturas, generar exploraciones visuales y definir wireframes, asegurando que las decisiones técnicas respondan efectivamente a los desafíos de consistencia transaccional y escalabilidad del negocio.

---

## Actividad 1 — Codiseñar con IA

### 1. Problema funcional
NexTech opera una red de 4 sucursales de hardware con inventarios desarticulados. La falta de visibilidad de stock en tiempo real genera sobreventas, mientras que en el taller técnico los egresos de componentes no se registran adecuadamente y existe confusión entre las colas de trabajo para armado de PCs y reparaciones.

**Usuarios:**
- Clientes: consultan stock y reservan mediante Click & Collect.
- Técnicos: consumen repuestos del inventario físico.
- Vendedores: gestionan ventas por mostrador y transferencias.
- Administrador: supervisa toda la plataforma y sucursales.

**Funcionalidades clave:** matriz de inventario multi-sucursal, sistema Click & Collect con PIN de retiro, y taller técnico segmentado en dos colas separadas (#ARM para armados y #ST para servicio técnico).

### 2. Definición de MVP1 (NUEVO — responde al feedback)
Para garantizar el éxito inicial, se ha acotado el alcance. El MVP1 incluye SOLO:
- Inventario multi-sucursal en tiempo real.
- Reserva atómica de stock mediante bloqueos pesimistas (`SELECT FOR UPDATE`).
- Flujo completo de Click & Collect con PIN de retiro.

**Excluido de MVP1 (para fases posteriores):**
- **MVP2:** Taller técnico con colas de trabajo (#ARM y #ST).
- **MVP3:** Armador de PC inteligente con chat técnico e IA como asistente.

**Justificación:** El flujo "inventario → reserva → retiro" constituye el núcleo de valor fundamental. Es imprescindible validar este ciclo con clientes reales y asegurar la consistencia del stock antes de introducir la complejidad operativa del taller o las recomendaciones asistidas por IA.

### 3. Modelo de datos completo (NUEVO)

```mermaid
erDiagram
    Sucursal {
        int id PK
        string nombre
        string direccion
        string telefono
        bool activa
    }
    Producto {
        int id PK
        string nombre
        string descripcion
        string categoria
        decimal precio
        string sku UK
        bool activo
    }
    InventarioSucursal {
        int id PK
        int sucursal_id FK
        int producto_id FK
        int stock_disponible
        int stock_reservado
        int stock_minimo
    }
    ReservaStock {
        int id PK
        int inventario_id FK
        int orden_id FK
        int cantidad
        timestamp vencimiento
        string estado
    }
    MovimientoInventario {
        int id PK
        int inventario_id FK
        int usuario_id FK
        string tipo
        int cantidad
        string motivo
        timestamp fecha
    }
    TransferenciaSucursal {
        int id PK
        int sucursal_origen_id FK
        int sucursal_destino_id FK
        int producto_id FK
        int cantidad
        string estado
        timestamp fecha_solicitud
        timestamp fecha_completada
    }
    OrdenClickCollect {
        int id PK
        int usuario_id FK
        int sucursal_id FK
        decimal total
        string estado
        timestamp fecha_creacion
        timestamp fecha_vencimiento
    }
    ItemOrden {
        int id PK
        int orden_id FK
        int producto_id FK
        int cantidad
        decimal precio_unitario
    }
    PINRetiro {
        int id PK
        int orden_id FK
        string codigo
        bool usado
        timestamp expiracion
    }
    Usuario {
        int id PK
        string nombre
        string email UK
        string password_hash
        int rol_id FK
        int sucursal_id FK
    }
    Rol {
        int id PK
        string nombre
        string permisos
    }

    Sucursal ||--o{ InventarioSucursal : tiene
    Producto ||--o{ InventarioSucursal : registrado_en
    InventarioSucursal ||--o{ ReservaStock : genera
    InventarioSucursal ||--o{ MovimientoInventario : registra
    OrdenClickCollect ||--o{ ItemOrden : contiene
    OrdenClickCollect ||--|| PINRetiro : tiene
    OrdenClickCollect ||--o{ ReservaStock : asocia
    Sucursal ||--o{ OrdenClickCollect : punto_retiro
    Usuario ||--o{ OrdenClickCollect : realiza
    TransferenciaSucursal }o--|| Sucursal : origen
    TransferenciaSucursal }o--|| Sucursal : destino
    TransferenciaSucursal }o--|| Producto : transfiere
    Usuario }o--|| Rol : tiene
    Usuario }o--o| Sucursal : asignado_a
```

| Entidad | Propósito y Justificación |
| :--- | :--- |
| **Sucursal / Producto** | Entidades base. Representan los nodos físicos y el catálogo. |
| **InventarioSucursal** | Matriz transaccional. (NUEVA) Añadida para separar `stock_disponible` y `stock_reservado`, vital para evitar sobreventas. |
| **ReservaStock** | (NUEVA) Traza el ciclo de vida de los bloqueos temporales de mercancía por usuario, permitiendo expiración y control atómico. |
| **MovimientoInventario** | (NUEVA) Tabla de auditoría inmutable para trazar ingresos, egresos, devoluciones y mermas (esencial para el taller en MVP2). |
| **TransferenciaSucursal** | (NUEVA) Gestiona el ciclo (origen → tránsito → destino) del movimiento interno de mercadería. |
| **OrdenClickCollect / ItemOrden** | Encabezado y detalle del carrito de compras reservado para retiro en sucursal. |
| **PINRetiro** | Mecanismo de seguridad para efectivizar la entrega, uniendo la orden digital con la operación física. |
| **Usuario / Rol** | Control de acceso basado en roles (RBAC) para diferenciar vistas de clientes, técnicos, vendedores y admins. |

### 4. Modelo de reserva y movimiento de stock (NUEVO — sección profundizada)

**Ciclo de vida de una reserva:**
- **PENDIENTE** → `stock_disponible` -= cantidad, `stock_reservado` += cantidad
- **CONFIRMADA** (cliente retiró) → `stock_reservado` -= cantidad (ya descontado definitivamente)
- **VENCIDA** (sin retiro en 24hs) → `stock_reservado` -= cantidad, `stock_disponible` += cantidad (se libera)
- **CANCELADA** → igual que vencida

```mermaid
stateDiagram-v2
    [*] --> PENDIENTE : Cliente reserva (SELECT FOR UPDATE)
    PENDIENTE --> CONFIRMADA : Cliente retira con PIN
    PENDIENTE --> VENCIDA : Pasan 24hs sin retiro
    PENDIENTE --> CANCELADA : Cliente cancela
    VENCIDA --> [*] : Stock liberado automáticamente
    CANCELADA --> [*] : Stock liberado
    CONFIRMADA --> [*] : Venta completada
```

**Reservar ≠ Descontar:** La diferencia es clave. Reservar bloquea el stock temporalmente; el cliente percibe que el producto ya no está disponible, pero físicamente sigue en la estantería del local. Descontar reduce el inventario permanentemente y sólo ocurre cuando se confirma el retiro con éxito.

**Gestión de devoluciones:** Cuando un producto regresa, se genera un `MovimientoInventario` de tipo 'devolucion', se incrementa el `stock_disponible` y se documenta el motivo para auditoría.

**Transferencias entre sucursales:** El proceso maneja estados (`solicitada` → `en_transito` → `completada`). El stock se descuenta de la sucursal origen al iniciar la transferencia y se acredita en el inventario de destino únicamente al completarla.

### 5. Diagrama de clases UML (Mermaid completo)

```mermaid
classDiagram
    class Sucursal {
        +int id
        +String nombre
        +String direccion
        +String telefono
        +bool activa
        +getInventario() List~InventarioSucursal~
    }
    class Producto {
        +int id
        +String nombre
        +String descripcion
        +String categoria
        +Decimal precio
        +String sku
        +bool activo
    }
    class InventarioSucursal {
        +int id
        +int stock_disponible
        +int stock_reservado
        +int stock_minimo
        +reservar(cantidad) bool
        +liberar(cantidad) void
        +descontar(cantidad) void
        +stockReal() int
    }
    class ReservaStock {
        +int id
        +int cantidad
        +DateTime vencimiento
        +String estado
        +verificarVencimiento() bool
        +confirmar() void
        +cancelar() void
    }
    class MovimientoInventario {
        +int id
        +String tipo
        +int cantidad
        +String motivo
        +DateTime fecha
    }
    class TransferenciaSucursal {
        +int id
        +int cantidad
        +String estado
        +DateTime fecha_solicitud
        +DateTime fecha_completada
        +iniciar() void
        +completar() void
        +cancelar() void
    }
    class OrdenClickCollect {
        +int id
        +Decimal total
        +String estado
        +DateTime fecha_creacion
        +DateTime fecha_vencimiento
        +confirmarRetiro(pin) bool
        +cancelar() void
    }
    class ItemOrden {
        +int id
        +int cantidad
        +Decimal precio_unitario
    }
    class PINRetiro {
        +int id
        +String codigo
        +bool usado
        +DateTime expiracion
        +validar(codigo) bool
    }
    class Usuario {
        +int id
        +String nombre
        +String email
        +int rol_id
    }
    class Rol {
        +int id
        +String nombre
        +String permisos
    }

    Sucursal "1" --> "many" InventarioSucursal : tiene
    Producto "1" --> "many" InventarioSucursal : registrado en
    InventarioSucursal "1" --> "many" ReservaStock : genera
    InventarioSucursal "1" --> "many" MovimientoInventario : audita
    OrdenClickCollect "1" --> "many" ItemOrden : contiene
    OrdenClickCollect "1" --> "1" PINRetiro : protegida por
    OrdenClickCollect "1" --> "many" ReservaStock : asocia
    TransferenciaSucursal --> Sucursal : origen/destino
    TransferenciaSucursal --> Producto : mueve
    Usuario --> Rol : tiene
    Usuario "1" --> "many" OrdenClickCollect : realiza
```

### 6. Consulta de arquitectura y evaluación crítica

> Actuá como arquitecto de software senior. Necesitamos diseñar la arquitectura de backend para una plataforma de inventario y taller en tiempo real para 4 sucursales de hardware informático, con venta web Click & Collect y sala de chat para armado de PCs. El equipo de desarrollo es de 2 personas y se requiere consistencia estricta en el inventario para evitar sobreventas. ¿Qué arquitectura recomendás y por qué?

**Respuesta resumida de la IA:** Sugirió un monolito modular (usando NestJS o FastAPI) respaldado por PostgreSQL (para cumplir con ACID) y Redis + WebSockets para notificaciones y chat en tiempo real. Desaconsejó enfáticamente una arquitectura de microservicios por el overhead operativo para un equipo de 2 personas y el tamaño del proyecto.

**Evaluación crítica del alumno:** Total acuerdo con la adopción de un monolito modular. Sin embargo, para satisfacer el requisito de consistencia estricta, la solución requiere explícitamente el uso de bloqueos pesimistas en base de datos (`SELECT FOR UPDATE`) para garantizar transaccionalidad sin colisiones en concurrencia (algo que la IA no profundizó en su primera iteración).

### 7. Justificación de tiempo real (NUEVO)

| Función | Mecanismo | Justificación |
|---|---|---|
| Stock disponible al reservar | WebSocket | Cliente A y B pueden reservar el último ítem simultáneamente. |
| Confirmación de reserva al vendedor | WebSocket | Vendedor ve en tiempo real qué stock está reservado. |
| Actualización de catálogo en background | Polling cada 30s | No requiere latencia sub-segundo. |
| Reportes históricos de movimientos | Request/Response REST | Solo lectura, sin concurrencia crítica. |
| Chat con técnico (MVP3) | WebSocket | Comunicación bidireccional en tiempo real. |

**Estimación de carga:** 4 sucursales × ~50 operaciones/hora pico → ~200 transacciones/hora. PostgreSQL maneja 1000+ tx/seg de forma fluida. Redis pub/sub escala horizontalmente sin problemas para esta demanda.

### 8. Co-diseño crítico — Tabla de decisiones

| Decisión | Propuesta IA | Corrección / Ajuste | Motivo del ajuste |
| :--- | :--- | :--- | :--- |
| **1. Vínculo armado–inventario** | Módulos separados, sin conexión | Relación directa al stock físico | El técnico necesita descontar piezas reales al armar. |
| **2. Validación de compatibilidad** | Motor de reglas complejo | Chat directo con humano (MVP2) | Excesiva complejidad para el MVP inicial. |
| **3. Organización del taller** | Una cola única de tickets | Dos colas: #ARM y #ST | Procesos distintos (armar es ensamblar stock, reparar es testear externo). |
| **4. Arquitectura de datos** | NoSQL (MongoDB) + SQL | PostgreSQL unificado | Se prioriza ACID y consistencia sobre flexibilidad documental. |
| **5. Canal de entrega** | Módulo de envíos integrado | 100% Click & Collect en local | Reducir fricción logística en la fase temprana de despliegue. |
| **6. Autenticación** | OAuth2 (Google) + JWT + Refresh | Auth básica por email/hash | OAuth2 añade complejidad de setup innecesaria para los 2 roles básicos de MVP1. |
| **7. Vencimiento de reservas** | Job Celery/Redis cada minuto | `lazy check` + cron PostgreSQL | Celery requiere un worker y broker extra; excesivo para baja concurrencia inicial. |

**Justificación unificada:** La IA tendió a proponer arquitecturas modernas pero sobredimensionadas (microservicios, Celery, OAuth2, motor de reglas). El rol humano fue fundamental para aterrizar el diseño a las capacidades operativas de un equipo de 2 personas, favoreciendo el pragmatismo tecnológico: base de datos robusta (PostgreSQL con bloqueos pesimistas), flujos simplificados (Click & Collect exclusivo) y arquitectura acotada (monolito modular) que aseguran un MVP robusto y entregable.

---

## Actividad 2 — Prompts iterativos y comparación arquitectónica

### Escenarios

**Escenario A (Clínica Médica):**
Sistema de gestión de turnos e historiales médicos para una clínica con 6 sucursales. Prioriza la privacidad (HIPAA/leyes locales) y la integridad de los datos.
*Estimaciones de carga:* 6 sucursales × 30 médicos × 8 turnos/día = 1440 turnos/día máx. Con picos de 50 consultas simultáneas al abrir. PostgreSQL (o incluso SQLite local si fuera stand-alone) maneja esto holgadamente.

**Escenario B (Plataforma de Streaming):**
Servicio global de streaming de video con millones de usuarios concurrentes. Requiere baja latencia global, altísima disponibilidad y manejo masivo de telemetría.
*Estimaciones de carga:* 1M usuarios concurrentes × 4 Mbps = 4 Tbps de ancho de banda. Requiere CDN multi-región obligatoriamente y la ingesta de ~10.000 eventos/segundo (Kafka necesario).

### Comparación Arquitectónica

| Dimensión | Sistema de Gestión Clínica (A) | Plataforma de Streaming (B) |
| :--- | :--- | :--- |
| **Patrón Arquitectónico** | Monolito o Cliente-Servidor clásico. | Microservicios distribuidos globalmente. |
| **Base de Datos** | SQL (PostgreSQL/SQL Server) para ACID estricto. | NoSQL (Cassandra, DynamoDB) + caché + Object Storage. |
| **Escalabilidad** | Vertical (servidores más grandes). | Horizontal masiva, auto-scaling en la nube. |
| **Consistencia vs Disponibilidad** | Prioriza Consistencia (CP en teorema CAP). | Prioriza Disponibilidad y Latencia (AP en teorema CAP). |
| **Despliegue** | On-premise o nube privada (por privacidad). | Nube pública, CDNs globales, Edge computing. |

---

## Actividades 3 y 4 — Prototipado y diseño de interfaz

### 1. Identificación del problema y solución
*Problema:* La plataforma requiere una interfaz que permita a los usuarios buscar productos de nicho y entender su disponibilidad en múltiples ubicaciones al instante, minimizando la frustración de reservas fallidas.
*Solución:* Una UI con un selector de sucursales prominente, indicadores visuales inmediatos de stock ('chips') y un flujo de compra de un clic hacia un PIN de recojo (Click & Collect).

### 2. Prompt para Midjourney (profesional, mejorado)

```text
Modern desktop web application UI for NexTech, a high-end gaming hardware store with multi-branch real-time inventory management. Dark mode interface, #0F172A background, neon cyan #00E5FF and violet #7C3AED accent colors, emerald green #10B981 for stock availability indicators, Inter sans-serif typography. Main screen shows: top navigation bar with branch selector dropdown (4 branches), product grid with hardware cards (GPU, CPU, RAM, SSD) each showing stock availability chips per branch, sticky floating cart summary on the right. Ultra-clean SaaS layout, 8px grid, micro-interactions visible, award-winning Figma UI design quality, 16:9 aspect ratio, 4k resolution, photorealistic UI mockup --ar 16:9 --v 6
```
**Evolución del prompt:** Se logró mayor precisión al definir la paleta cromática exacta (Hex codes), la tipografía (Inter), el sistema de grilla (8px) y al especificar detalladamente los componentes clave de la UI (dropdown de sucursal, indicadores de stock). Se actualizó a la versión 6 de Midjourney para mayor fotorrealismo.

### 3. Wireframes (3 pantallas clave)
1. **Catálogo:** Vista principal con grid de productos, barra superior con selector de sucursal y chips de estado de inventario por ítem.
2. **Reserva Click & Collect:** Modal/pantalla de confirmación con detalles del ítem, selector de cantidad y botón de acción principal para asegurar el inventario.
3. **Mi Orden / Seguimiento:** Panel del usuario mostrando el PIN de 6 dígitos generado, cuenta regresiva de 24 horas y estado de la reserva.

> **Nota:** Los wireframes están implementados funcionalmente en el prototipo ejecutable (ver sección Prototipo Funcional).

### 4. Prompt para Figma AI (NUEVO — para uso externo)

```text
Create a 3-screen web app prototype for NexTech Hardware Store:

Screen 1 - Catalog: Dark mode (#0F172A bg, #1E293B cards). Top navbar with NexTech logo and branch dropdown. Product grid (3 cols) with hardware cards: product image placeholder, name, price, and stock chips per branch (green dot + count if available, red dot + 'Sin stock' if 0). CTA button 'Reservar' on each card.

Screen 2 - Click & Collect Reservation: Selected product details. Branch selector (only branches with stock). Quantity selector. Optional email field. 'Confirmar Reserva' primary button (cyan). Success modal with order ID, 6-digit PIN, and 24h expiry.

Screen 3 - My Order: Order ID search input. Order detail card showing: items, branch, total, expiry date. If status = 'reservada': PIN input field + 'Confirmar Retiro' button. Status badge with color coding.

Design system: Inter font, 8px grid, border-radius 12px, cyan (#00E5FF) primary, violet (#7C3AED) secondary, emerald (#10B981) success, red (#EF4444) error.

Make it navigable (clickable prototype). Connect Screen 1 button to Screen 2, and reservation success modal to Screen 3.
```

### 5. Justificación de decisiones de diseño
El diseño adopta un 'Dark Mode' que resuena con la estética gamer del público objetivo. Los chips de estado (verdes para disponible, rojos para agotado) ofrecen lectura cognitiva rápida en el catálogo. La simplicidad del flujo hacia la obtención del PIN reduce la fricción transaccional. Además, desde el backend, el diseño contempla que el botón "Reservar" gatilla un bloqueo atómico; visualmente esto previene el comportamiento de "stock fantasma" que genera malas experiencias de usuario.

---

## Prototipo Funcional Ejecutable (NUEVO)

La arquitectura del prototipo materializa el MVP1 usando un stack moderno pero monolítico:
- **Backend:** FastAPI (Python) para alto rendimiento asíncrono, SQLAlchemy como ORM, PostgreSQL como motor relacional.
- **Frontend:** Vanilla HTML/CSS/JS (para mantener la prueba de concepto ligera y sin build steps).
- **Despliegue local:** Requiere entorno Python 3.9+ y base de datos PostgreSQL local (detalles en el `README.md` del código fuente).

**Endpoints implementados:**

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/sucursales` | Lista las 4 sucursales. |
| GET | `/api/productos` | Lista todos los productos en catálogo. |
| GET | `/api/stock` | Consulta stock por sucursal (filtrable). |
| POST | `/api/reservas` | Reserva atómica garantizada con `SELECT FOR UPDATE`. |
| GET | `/api/reservas/{id}` | Verifica estado y tiempo restante de la reserva. |
| POST | `/api/ordenes/confirmar-retiro`| Confirma retiro canjeando el PIN. |
| GET | `/api/ordenes/{id}` | Detalle completo de la orden generada. |
| POST | `/api/transferencias` | Gestiona el movimiento de stock entre sucursales. |

**Nota sobre el rol de la IA en el producto (Evolución hacia MVP3):**
La IA no actuará como un tomador de decisiones transaccionales. En el MVP3, funcionará exclusivamente como **asistente de armado**:
- El usuario dialoga sus requerimientos (presupuesto, perfil gamer o de diseño).
- La IA recomienda un ensamble.
- **El sistema (determinístico) toma el control** para cruzar esa recomendación contra el stock real y las reglas de compatibilidad de hardware.
- **Regla de oro:** La IA recomienda, el sistema valida y ejecuta la reserva.

---

## Plan de desarrollo y pruebas (NUEVO)

| Sprint | Duración | Entregables |
|---|---|---|
| **Sprint 1** | 2 semanas | Inventario multi-sucursal: CRUD de sucursales, productos y visibilidad de stock. |
| **Sprint 2** | 2 semanas | Reserva de stock: bloqueo atómico, vencimiento y liberación automática. |
| **Sprint 3** | 2 semanas | Click & Collect: gestión de órdenes, emisión de PIN, confirmación de retiro en caja. |
| **Sprint 4** | 2 semanas | Seguridad: Autenticación básica y roles (admin, vendedor, cliente). |
| **Sprint 5** | 2 semanas | Operaciones: Transferencias entre sucursales y auditoría de `MovimientoInventario`. |

**Casos de prueba de concurrencia críticos:**
1. **Doble reserva simultánea:** Dos usuarios intentan reservar el último ítem al mismo tiempo → solo uno debe tener éxito, el otro recibe HTTP 409 Conflict.
2. **Vencimiento de reserva:** Crear reserva, adelantar reloj 24hs (o simular expiración), intentar confirmar retiro → debe rechazar y el stock debe figurar liberado.
3. **Transferencia con stock insuficiente:** Intentar mover más unidades de las existentes en la sucursal origen → debe rechazar (HTTP 409).
4. **PIN incorrecto:** Enviar PIN erróneo al endpoint de retiro → rechazo inmediato, reserva intacta.
5. **PIN ya usado:** Reintentar canjear un PIN de una orden ya completada → debe rechazar.

---

## Estrategia de evolución técnica (NUEVO)

**¿Cómo escalar de 4 a 40 sucursales?**
El monolito modular puede escalar horizontalmente añadiendo instancias de la aplicación detrás de un Load Balancer. PostgreSQL escala verticalmente sin problemas hasta ~100 sucursales con esta carga de trabajo. Si los reportes o catálogos se vuelven pesados, se introduce una *Read Replica* de PostgreSQL para absorber las consultas `GET`, dejando la base principal sólo para escrituras (`POST`/`PUT`).

**¿Cuándo migrar a microservicios?**
Solamente cuando el monitoreo identifique cuellos de botella aislables. Por ejemplo, si el procesamiento del Chat Técnico de IA (MVP3) ahoga los recursos de la CPU, se extrae ese módulo a un microservicio independiente. Se adopta la estrategia del *Strangler Fig*, nunca una reescritura total.

**¿Cómo monitorear la consistencia del inventario?**
- Alertas de discrepancia (e.g. `stock_disponible` + `stock_reservado` > stock físico total).
- Auditoría basada en la inmutabilidad de la tabla `MovimientoInventario`.
- Dashboards administrativos de trazabilidad por sucursal para cruzar rápidamente métricas del sistema vs. conteo físico.

---

## Autoevaluación

| Criterio | Puntaje (1-5) | Justificación |
| :--- | :--- | :--- |
| **Claridad del problema** | 5 | Se expuso con precisión el problema de sincronización y los perfiles de usuario. |
| **Uso de IA en diseño** | 5 | Prompts iterativos, corrección de desviaciones arquitectónicas de la IA. |
| **Arquitectura de datos** | 5 | Modelo relacional completo, consistente y orientado a concurrencia. |
| **Prototipado UI** | 5 | Wireframes alineados a un prompt hiperdetallado y justificados funcionalmente. |
| **Reflexión Crítica** | 5 | Se comprendió cuándo la IA asiste, y cuándo el arquitecto debe imponer restricciones duras (e.g. SELECT FOR UPDATE). |
