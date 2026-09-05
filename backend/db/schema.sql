-- Script DDL para inicializar la base de datos de NexTech MVP1
-- Motor: PostgreSQL

-- Crear tabla de roles
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL, -- admin, vendedor, tecnico, cliente
    permisos TEXT
);

-- Crear tabla de sucursales
CREATE TABLE IF NOT EXISTS sucursales (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    direccion VARCHAR(255),
    telefono VARCHAR(50),
    activa BOOLEAN DEFAULT TRUE
);

-- Crear tabla de usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol_id INTEGER NOT NULL REFERENCES roles(id),
    sucursal_id INTEGER REFERENCES sucursales(id)
);
CREATE INDEX idx_usuarios_email ON usuarios(email);

-- Crear tabla de productos
CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    categoria VARCHAR(100),
    precio NUMERIC(10, 2) NOT NULL,
    sku VARCHAR(50) UNIQUE NOT NULL,
    activo BOOLEAN DEFAULT TRUE
);
CREATE INDEX idx_productos_sku ON productos(sku);

-- Crear tabla de inventarios en sucursales
CREATE TABLE IF NOT EXISTS inventarios_sucursales (
    id SERIAL PRIMARY KEY,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    stock_disponible INTEGER NOT NULL DEFAULT 0,
    stock_reservado INTEGER NOT NULL DEFAULT 0,
    stock_minimo INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_sucursal_producto UNIQUE(sucursal_id, producto_id)
);
-- Índices solicitados
CREATE INDEX idx_inventarios_sucursal ON inventarios_sucursales(sucursal_id);
CREATE INDEX idx_inventarios_producto ON inventarios_sucursales(producto_id);

-- Crear tabla de ordenes Click Collect
CREATE TABLE IF NOT EXISTS ordenes_click_collect (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id),
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    total NUMERIC(10, 2) NOT NULL,
    estado VARCHAR(50) NOT NULL, -- pendiente, reservada, lista_retiro, retirada, cancelada, vencida
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento TIMESTAMP
);

-- Crear tabla de items de orden
CREATE TABLE IF NOT EXISTS items_orden (
    id SERIAL PRIMARY KEY,
    orden_id INTEGER NOT NULL REFERENCES ordenes_click_collect(id),
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    cantidad INTEGER NOT NULL,
    precio_unitario NUMERIC(10, 2) NOT NULL
);

-- Crear tabla de pines de retiro
CREATE TABLE IF NOT EXISTS pines_retiro (
    id SERIAL PRIMARY KEY,
    orden_id INTEGER UNIQUE NOT NULL REFERENCES ordenes_click_collect(id),
    codigo VARCHAR(6) NOT NULL,
    usado BOOLEAN DEFAULT FALSE,
    expiracion TIMESTAMP NOT NULL
);

-- Crear tabla de reservas de stock
CREATE TABLE IF NOT EXISTS reservas_stock (
    id SERIAL PRIMARY KEY,
    inventario_id INTEGER NOT NULL REFERENCES inventarios_sucursales(id),
    orden_id INTEGER REFERENCES ordenes_click_collect(id),
    cantidad INTEGER NOT NULL,
    vencimiento TIMESTAMP NOT NULL,
    estado VARCHAR(50) NOT NULL -- pendiente, confirmada, vencida, cancelada
);

-- Crear tabla de movimientos de inventario
CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id SERIAL PRIMARY KEY,
    inventario_id INTEGER NOT NULL REFERENCES inventarios_sucursales(id),
    usuario_id INTEGER REFERENCES usuarios(id),
    tipo VARCHAR(50) NOT NULL, -- entrada, salida, reserva, liberacion, transferencia, devolucion
    cantidad INTEGER NOT NULL,
    motivo TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de transferencias entre sucursales
CREATE TABLE IF NOT EXISTS transferencias_sucursales (
    id SERIAL PRIMARY KEY,
    sucursal_origen_id INTEGER NOT NULL REFERENCES sucursales(id),
    sucursal_destino_id INTEGER NOT NULL REFERENCES sucursales(id),
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    cantidad INTEGER NOT NULL,
    estado VARCHAR(50) NOT NULL, -- solicitada, en_transito, completada, cancelada
    fecha_solicitud TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_completada TIMESTAMP
);

-- ---------------------------------------------------------
-- DATOS DE EJEMPLO
-- ---------------------------------------------------------

-- Insertar roles
INSERT INTO roles (nombre) VALUES 
('admin'), ('vendedor'), ('tecnico'), ('cliente')
ON CONFLICT DO NOTHING;

-- Insertar 4 sucursales
INSERT INTO sucursales (nombre, direccion, telefono) VALUES
('Central Obelisco', 'Av. Corrientes 1000, CABA', '11-4555-0001'),
('Palermo Soho', 'Honduras 5000, CABA', '11-4555-0002'),
('Belgrano Tech', 'Cabildo 2000, CABA', '11-4555-0003'),
('Zona Norte Martínez', 'Av. Santa Fe 1500, Martínez', '11-4555-0004');

-- Insertar ~8 productos de hardware
INSERT INTO productos (nombre, descripcion, categoria, precio, sku) VALUES
('Notebook Dell XPS 15', 'Intel Core i9, 32GB RAM, 1TB SSD', 'Laptops', 2500.00, 'NB-DELL-XPS15'),
('Notebook ThinkPad T14', 'AMD Ryzen 7, 16GB RAM, 512GB SSD', 'Laptops', 1400.00, 'NB-LEN-T14'),
('Monitor LG UltraWide 34"', 'Monitor curvo 34 pulgadas 144Hz', 'Monitores', 850.00, 'MON-LG-34UW'),
('Teclado Mecánico Keychron K2', 'Teclado mecánico wireless Gateron Brown', 'Periféricos', 120.00, 'PER-KEY-K2'),
('Mouse Logitech MX Master 3S', 'Mouse ergonómico inalámbrico', 'Periféricos', 100.00, 'PER-LOG-MX3S'),
('Auriculares Sony WH-1000XM5', 'Auriculares con cancelación de ruido', 'Audio', 350.00, 'AUD-SONY-XM5'),
('Disco SSD Samsung 980 Pro 2TB', 'SSD NVMe M.2 2TB PCIe 4.0', 'Almacenamiento', 200.00, 'STO-SAM-980P2T'),
('Memoria RAM Corsair Vengeance 32GB', 'DDR5 5600MHz 2x16GB', 'Componentes', 150.00, 'COM-COR-32DDR5');

-- Poblar inventarios para las 4 sucursales y 8 productos (Total 32 registros)
-- Se asigna un stock aleatorio de ejemplo
INSERT INTO inventarios_sucursales (sucursal_id, producto_id, stock_disponible, stock_minimo)
SELECT s.id, p.id, floor(random() * 50 + 5)::int, 5
FROM sucursales s CROSS JOIN productos p;
