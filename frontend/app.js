// URL base de la API
const API_BASE_URL = 'http://localhost:8000';

// Estado global de la aplicación
const state = {
    productos: [],
    sucursales: [],
    categoriaActiva: 'todos',
    productoParaModal: null,
    ultimaRecomendacionIA: null
};

// ==========================================================================
// NAVEGACIÓN Y TABS
// ==========================================================================

document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        document.querySelectorAll('.seccion').forEach(s => {
            s.classList.remove('activa');
        });

        const targetId = e.target.getAttribute('data-target');
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
            targetEl.classList.add('activa');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
});

// Selector global de sucursal
document.getElementById('sucursal-global').addEventListener('change', (e) => {
    renderProductos(state.productos, e.target.value);
});

// Toast flotante
function showToast(mensaje, tipo = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.textContent = mensaje;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3800);
}

// ==========================================================================
// SECCIÓN 1: CATÁLOGO, STOCK & FILTROS
// ==========================================================================

async function cargarSucursales() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/sucursales`);
        if (res.ok) {
            state.sucursales = await res.json();
            const selectGlobal = document.getElementById('sucursal-global');
            selectGlobal.innerHTML = '<option value="todas">Todas las sucursales</option>';
            state.sucursales.forEach(suc => {
                const opt = document.createElement('option');
                opt.value = suc.id;
                opt.textContent = suc.nombre;
                selectGlobal.appendChild(opt);
            });
        }
    } catch (e) {
        console.warn('Backend no disponible para sucursales, usando lista por defecto.');
        state.sucursales = [
            { id: 1, nombre: "Central Obelisco" },
            { id: 2, nombre: "Palermo Soho" },
            { id: 3, nombre: "Belgrano Tech" },
            { id: 4, nombre: "Zona Norte Martínez" }
        ];
    }
}

async function cargarCatalogo() {
    const loadingEl = document.getElementById('loading-catalogo');
    if (loadingEl) loadingEl.style.display = 'block';

    try {
        await cargarSucursales();

        const [resProd, resStock] = await Promise.all([
            fetch(`${API_BASE_URL}/api/productos`),
            fetch(`${API_BASE_URL}/api/stock`)
        ]);

        if (resProd.ok && resStock.ok) {
            const productos = await resProd.json();
            const stocks = await resStock.json();

            state.productos = productos.map(p => {
                const stockMap = {};
                state.sucursales.forEach(suc => {
                    const itemStock = stocks.find(s => s.producto_id === p.id && s.sucursal_id === suc.id);
                    stockMap[suc.id] = itemStock ? itemStock.stock_disponible : 0;
                });
                return { ...p, stock: stockMap };
            });

            if (loadingEl) loadingEl.style.display = 'none';
            renderProductos(state.productos, document.getElementById('sucursal-global').value);
            return;
        }
    } catch (error) {
        console.warn('Conexión con backend falló, usando datos locales:', error);
    }

    // Fallback de contingencia
    state.productos = [
        { id: 1, nombre: "Notebook Dell XPS 15", categoria: "Laptops", precio: 2500, stock: { 1: 5, 2: 0, 3: 12, 4: 8 } },
        { id: 2, nombre: "Notebook ThinkPad T14", categoria: "Laptops", precio: 1400, stock: { 1: 15, 2: 4, 3: 6, 4: 10 } },
        { id: 3, nombre: "Monitor LG UltraWide 34\"", categoria: "Monitores", precio: 850, stock: { 1: 3, 2: 15, 3: 0, 4: 6 } },
        { id: 4, nombre: "Teclado Mecánico Keychron K2", categoria: "Periféricos", precio: 120, stock: { 1: 10, 2: 20, 3: 5, 4: 0 } },
        { id: 5, nombre: "Mouse Logitech MX Master 3S", categoria: "Periféricos", precio: 100, stock: { 1: 18, 2: 7, 3: 12, 4: 15 } },
        { id: 6, nombre: "Auriculares Sony WH-1000XM5", categoria: "Audio", precio: 350, stock: { 1: 8, 2: 0, 3: 4, 4: 2 } },
        { id: 7, nombre: "Disco SSD Samsung 980 Pro 2TB", categoria: "Componentes", precio: 200, stock: { 1: 25, 2: 14, 3: 10, 4: 18 } },
        { id: 8, nombre: "Memoria RAM Corsair Vengeance 32GB", categoria: "Componentes", precio: 150, stock: { 1: 30, 2: 22, 3: 15, 4: 8 } }
    ];
    if (loadingEl) loadingEl.style.display = 'none';
    renderProductos(state.productos, document.getElementById('sucursal-global').value);
}

// Filtros de Categorías
function filtrarPorTag(categoria, btnElement) {
    state.categoriaActiva = categoria;
    document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('activo'));
    if (btnElement) btnElement.classList.add('activo');
    renderProductos(state.productos, document.getElementById('sucursal-global').value);
}

function filtrarCategoria(categoria) {
    document.querySelectorAll('.filtro-btn').forEach(b => {
        if (b.textContent.toLowerCase() === categoria.toLowerCase()) {
            b.classList.add('activo');
        } else {
            b.classList.remove('activo');
        }
    });
    filtrarPorTag(categoria, null);
    const heading = document.getElementById('catalogo-heading');
    if (heading) heading.scrollIntoView({ behavior: 'smooth' });
}

// Renderizado de Grilla de Productos
function renderProductos(productos, sucursalFiltro) {
    const grilla = document.getElementById('grilla-productos');
    if (!grilla) return;
    grilla.innerHTML = '';

    // Filtrar por categoría seleccionada
    let productosFiltrados = productos;
    if (state.categoriaActiva !== 'todos') {
        productosFiltrados = productos.filter(p => 
            (p.categoria && p.categoria.toLowerCase() === state.categoriaActiva.toLowerCase())
        );
    }

    if (productosFiltrados.length === 0) {
        grilla.innerHTML = '<p class="text-sm text-muted">No hay productos en esta categoría o sucursal.</p>';
        return;
    }

    productosFiltrados.forEach(prod => {
        const card = document.createElement('div');
        card.className = 'card producto-card';
        
        let chipsHtml = '';
        state.sucursales.forEach(suc => {
            if (sucursalFiltro !== 'todas' && String(sucursalFiltro) !== String(suc.id)) return;

            const qty = (prod.stock && prod.stock[suc.id] !== undefined) ? prod.stock[suc.id] : 0;
            let statusClass = 'stock-out';
            let icon = '✗';
            
            if (qty > 5) {
                statusClass = 'stock-ok';
                icon = '✓';
            } else if (qty > 0) {
                statusClass = 'stock-low';
                icon = '⚠';
            }

            chipsHtml += `<div class="chip ${statusClass}">
                <span>${suc.nombre}</span>
                <span>${qty} ${icon}</span>
            </div>`;
        });

        const totalStock = prod.stock ? Object.values(prod.stock).reduce((a, b) => a + b, 0) : 0;

        card.innerHTML = `
            <div>
                <h3 class="producto-nombre">${prod.nombre}</h3>
                <p class="producto-categoria">${prod.categoria || 'Hardware'}</p>
                <p class="producto-precio">$${Number(prod.precio).toLocaleString('es-AR')}</p>
                <div class="stock-chips">
                    ${chipsHtml}
                </div>
            </div>
            <button class="btn btn-outline btn-block" ${totalStock === 0 ? 'disabled' : ''} onclick="abrirModalReserva(${prod.id})">
                ${totalStock === 0 ? 'Sin Stock' : '⚡ Reservar (Click & Collect)'}
            </button>
        `;
        grilla.appendChild(card);
    });
}

// ==========================================================================
// MODAL EMERGENTE DE RESERVA (PANTALLA EMERGENTE)
// ==========================================================================

function abrirModalReserva(productoId, sucursalPreseleccionada = null) {
    const producto = state.productos.find(p => p.id === productoId);
    if (!producto) return;

    state.productoParaModal = producto;

    // Actualizar vista previa del producto en el modal
    document.getElementById('modal-producto-id').value = producto.id;
    document.getElementById('modal-prod-nombre').textContent = producto.nombre;
    document.getElementById('modal-prod-categoria').textContent = producto.categoria || 'Hardware';
    document.getElementById('modal-prod-precio').textContent = `$${Number(producto.precio).toLocaleString('es-AR')}`;

    // Poblar dropdown de sucursales que tengan stock disponible
    const selectSucursal = document.getElementById('modal-reserva-sucursal');
    selectSucursal.innerHTML = '';
    let primeraConStock = null;

    state.sucursales.forEach(suc => {
        const stock = (producto.stock && producto.stock[suc.id]) || 0;
        if (stock > 0) {
            if (!primeraConStock) primeraConStock = suc.id;
            const option = document.createElement('option');
            option.value = suc.id;
            option.textContent = `${suc.nombre} (${stock} un. disponibles)`;
            option.dataset.max = stock;
            if (sucursalPreseleccionada && String(suc.id) === String(sucursalPreseleccionada)) {
                option.selected = true;
                primeraConStock = suc.id;
            }
            selectSucursal.appendChild(option);
        }
    });

    if (!primeraConStock) {
        showToast('Este producto no tiene stock disponible para reserva en ninguna sucursal', 'error');
        return;
    }

    // Resetear cantidad a 1 y recalcular
    const inputCant = document.getElementById('modal-reserva-cantidad');
    inputCant.value = 1;
    actualizarMaxCantidadModal();

    // Abrir modal emergente
    document.getElementById('modal-flujo-reserva').classList.add('activo');
}

// Cerrar modal de reserva
document.getElementById('btn-cerrar-modal-reserva').addEventListener('click', cerrarModalReserva);
document.getElementById('modal-flujo-reserva').addEventListener('click', (e) => {
    if (e.target.id === 'modal-flujo-reserva') cerrarModalReserva();
});

function cerrarModalReserva() {
    document.getElementById('modal-flujo-reserva').classList.remove('activo');
}

// Controles de cantidad (+ / -) y subtotal
document.getElementById('modal-reserva-sucursal').addEventListener('change', actualizarMaxCantidadModal);
document.getElementById('modal-reserva-cantidad').addEventListener('input', recalcularSubtotalModal);

document.getElementById('qty-btn-minus').addEventListener('click', () => {
    const input = document.getElementById('modal-reserva-cantidad');
    let val = parseInt(input.value) || 1;
    if (val > 1) {
        input.value = val - 1;
        recalcularSubtotalModal();
    }
});

document.getElementById('qty-btn-plus').addEventListener('click', () => {
    const input = document.getElementById('modal-reserva-cantidad');
    const max = parseInt(input.max) || 100;
    let val = parseInt(input.value) || 1;
    if (val < max) {
        input.value = val + 1;
        recalcularSubtotalModal();
    }
});

function actualizarMaxCantidadModal() {
    const select = document.getElementById('modal-reserva-sucursal');
    const inputCant = document.getElementById('modal-reserva-cantidad');
    const infoSpan = document.getElementById('modal-max-stock-info');
    const hintSpan = document.getElementById('modal-sucursal-hint');
    
    if (select.selectedOptions.length > 0) {
        const max = parseInt(select.selectedOptions[0].dataset.max) || 1;
        inputCant.max = max;
        if (parseInt(inputCant.value) > max) {
            inputCant.value = max;
        }
        infoSpan.textContent = `Stock disponible: ${max} un.`;
        hintSpan.textContent = `Retiro inmediato disponible en ${select.selectedOptions[0].text.split('(')[0].trim()}`;
    }
    recalcularSubtotalModal();
}

function recalcularSubtotalModal() {
    if (!state.productoParaModal) return;
    const inputCant = document.getElementById('modal-reserva-cantidad');
    let cant = parseInt(inputCant.value) || 1;
    const subtotal = cant * Number(state.productoParaModal.precio);
    document.getElementById('modal-resumen-subtotal').textContent = `$${subtotal.toLocaleString('es-AR')}`;
}

// Enviar Reserva Atómica desde el Modal
document.getElementById('form-reserva-modal').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const btnSubmit = document.getElementById('btn-submit-reserva');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Bloqueando stock en inventario...';

    const productoId = parseInt(document.getElementById('modal-producto-id').value);
    const sucursalId = parseInt(document.getElementById('modal-reserva-sucursal').value);
    const cantidad = parseInt(document.getElementById('modal-reserva-cantidad').value);
    const email = document.getElementById('modal-reserva-email').value.trim();

    const payload = {
        sucursal_id: sucursalId,
        items: [{ producto_id: productoId, cantidad: cantidad }],
        usuario_email: email || null
    };

    try {
        const res = await fetch(`${API_BASE_URL}/api/reservas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ detail: 'Error al reservar' }));
            throw new Error(errData.detail || 'Conflicto de stock en la reserva');
        }

        const data = await res.json();

        // Cerrar modal de formulario
        cerrarModalReserva();

        // Mostrar Modal Emergente de Éxito
        document.getElementById('modal-exito-orden-id').textContent = `ORD-${data.orden_id}`;
        document.getElementById('modal-exito-pin').textContent = data.pin;
        document.getElementById('modal-exito-vencimiento').textContent = new Date(data.vencimiento).toLocaleString('es-AR');
        document.getElementById('modal-exito-reserva').classList.add('activo');

        showToast('¡Reserva confirmada con bloqueo pesimista en base de datos!', 'success');

        // Recargar inventario para actualizar chips en tiempo real
        cargarCatalogo();

    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '🔒 Confirmar Reserva Atómica';
    }
});

// Botones del Modal de Éxito
document.getElementById('btn-copiar-pin').addEventListener('click', () => {
    const pin = document.getElementById('modal-exito-pin').textContent;
    navigator.clipboard.writeText(pin).then(() => {
        showToast('¡PIN de retiro copiado al portapapeles!', 'success');
    }).catch(() => {
        showToast(`PIN: ${pin}`, 'info');
    });
});

document.getElementById('btn-cerrar-exito').addEventListener('click', () => {
    document.getElementById('modal-exito-reserva').classList.remove('activo');
    // Pre-cargar ID en la sección de Órdenes y navegar allí
    const ordenTexto = document.getElementById('modal-exito-orden-id').textContent.replace('ORD-', '');
    document.getElementById('buscar-orden-id').value = ordenTexto;
    document.querySelector('[data-target="seccion-ordenes"]').click();
});

// ==========================================================================
// SECCIÓN 2: ASISTENTE INTELIGENTE IA
// ==========================================================================

function aplicarSugerencia(texto) {
    document.getElementById('input-consulta-ia').value = texto;
    consultarAsistenteIA();
}

document.getElementById('btn-consultar-ia').addEventListener('click', consultarAsistenteIA);
document.getElementById('input-consulta-ia').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') consultarAsistenteIA();
});

async function consultarAsistenteIA() {
    const input = document.getElementById('input-consulta-ia');
    const mensaje = input.value.trim();
    if (!mensaje) {
        showToast('Por favor escribe tu consulta para el Asistente IA', 'error');
        return;
    }

    const btn = document.getElementById('btn-consultar-ia');
    btn.disabled = true;
    btn.textContent = 'Analizando inventario...';

    const sucursalVal = document.getElementById('sucursal-global').value;
    const sucursalId = sucursalVal !== 'todas' ? parseInt(sucursalVal) : null;

    try {
        const res = await fetch(`${API_BASE_URL}/api/ia/consultar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mensaje: mensaje, sucursal_id: sucursalId })
        });

        if (!res.ok) {
            throw new Error('No se pudo procesar la consulta con el asistente');
        }

        const data = await res.json();
        state.ultimaRecomendacionIA = data;

        const container = document.getElementById('ia-resultado');
        container.style.display = 'block';

        document.getElementById('ia-modelo-nombre').textContent = data.modelo_utilizado;
        document.getElementById('ia-sucursal-nombre').textContent = `Sucursal asignada: ${data.sucursal_nombre}`;
        document.getElementById('ia-texto-salida').innerHTML = data.respuesta.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Renderizar productos recomendados
        const prodsGrilla = document.getElementById('ia-productos-recomendados');
        prodsGrilla.innerHTML = '';
        data.productos.forEach(p => {
            const card = document.createElement('div');
            card.className = 'card producto-card';
            card.innerHTML = `
                <div>
                    <h3 class="producto-nombre">${p.nombre}</h3>
                    <p class="producto-categoria">${p.categoria}</p>
                    <p class="producto-precio">$${Number(p.precio).toLocaleString('es-AR')}</p>
                    <div class="chip stock-ok mt-20" style="display: inline-block;">
                        <span>✓ ${p.stock_disponible} unidades disponibles en ${p.sucursal_nombre}</span>
                    </div>
                </div>
                <button class="btn btn-outline btn-block mt-15" onclick="abrirModalReserva(${p.id}, ${p.sucursal_id})">
                    Reservar este producto
                </button>
            `;
            prodsGrilla.appendChild(card);
        });

        document.getElementById('ia-total-monto').textContent = `$${Number(data.total).toLocaleString('es-AR')}`;

        showToast('Recomendación generada con stock validado en tiempo real', 'success');
        container.scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Consultar Asistente';
    }
}

// Botón de 1-clic para reservar la recomendación completa de la IA
document.getElementById('btn-ia-reservar').addEventListener('click', () => {
    if (!state.ultimaRecomendacionIA || !state.ultimaRecomendacionIA.productos.length) {
        showToast('No hay productos recomendados para reservar', 'error');
        return;
    }

    const primerProd = state.ultimaRecomendacionIA.productos[0];
    const sucursalId = state.ultimaRecomendacionIA.sucursal_id;

    abrirModalReserva(primerProd.id, sucursalId);
    showToast(`Abriendo reserva para ${primerProd.nombre} en ${state.ultimaRecomendacionIA.sucursal_nombre}`, 'info');
});

// ==========================================================================
// SECCIÓN 3: GESTIÓN DE RETIRO EN MOSTRADOR CON PIN
// ==========================================================================

document.getElementById('btn-buscar-orden').addEventListener('click', async () => {
    let inputVal = document.getElementById('buscar-orden-id').value.trim();
    if (!inputVal) {
        showToast('Ingresá un ID de orden', 'error');
        return;
    }

    const ordenId = parseInt(inputVal.replace(/^ORD-/i, ''));
    if (isNaN(ordenId)) {
        showToast('Formato de orden inválido. Ingresá un número como 1 o ORD-1', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/ordenes/${ordenId}`);
        if (!res.ok) {
            throw new Error('Orden no encontrada');
        }

        const orden = await res.json();
        const sucursal = state.sucursales.find(s => s.id === orden.sucursal_id) || { nombre: `Sucursal #${orden.sucursal_id}` };
        
        const resDiv = document.getElementById('orden-resultado');
        resDiv.style.display = 'block';

        let itemsHtml = orden.items.map(it => `<li>Producto #${it.producto_id} - Cantidad: ${it.cantidad} ($${Number(it.precio_unitario).toLocaleString('es-AR')} c/u)</li>`).join('');

        resDiv.innerHTML = `
            <h3>Detalles de la Orden #ORD-${orden.id}</h3>
            <p><strong>Estado Actual:</strong> <span class="chip ${orden.estado === 'retirada' ? 'stock-ok' : 'stock-low'}" style="display:inline-block; margin-left:5px;">${orden.estado.toUpperCase()}</span></p>
            <p><strong>Sucursal de Retiro:</strong> ${sucursal.nombre}</p>
            <p><strong>Total de la Orden:</strong> $${Number(orden.total).toLocaleString('es-AR')}</p>
            <p><strong>Fecha de Creación:</strong> ${new Date(orden.fecha_creacion).toLocaleString('es-AR')}</p>
            <div class="mt-20">
                <strong>Artículos de la Reserva:</strong>
                <ul style="margin-left: 20px; margin-top: 5px;">${itemsHtml}</ul>
            </div>
            
            ${(orden.estado === 'reservada' || orden.estado === 'lista_retiro') ? `
                <div class="mt-20 info-box">
                    <label><strong>Confirmar Retiro en Mostrador</strong></label>
                    <p class="text-sm text-muted">El personal del local debe validar el PIN de 6 dígitos que presentó el cliente.</p>
                    <div class="search-bar mt-15">
                        <input type="text" id="pin-retiro-input" class="form-input" placeholder="Ingresá PIN de 6 dígitos (ej: 0C3G29)">
                        <button onclick="confirmarRetiro(${orden.id})" class="btn btn-primary">Validar PIN y Entregar</button>
                    </div>
                </div>
            ` : '<div class="mt-20 text-green font-bold">✓ Esta orden ya fue retirada y el stock fue descontado permanentemente del inventario.</div>'}
        `;

    } catch (error) {
        showToast(error.message, 'error');
        document.getElementById('orden-resultado').style.display = 'none';
    }
});

async function confirmarRetiro(ordenId) {
    const pin = document.getElementById('pin-retiro-input').value.trim();
    if (!pin) {
        showToast('Ingresá el PIN de seguridad', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/ordenes/confirmar-retiro`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden_id: ordenId, pin: pin })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ detail: 'Error al confirmar retiro' }));
            throw new Error(errData.detail || 'PIN incorrecto o no válido');
        }

        showToast('¡Retiro confirmado exitosamente! Stock descontado de forma definitiva.', 'success');
        document.getElementById('buscar-orden-id').value = ordenId;
        document.getElementById('btn-buscar-orden').click();
        
        cargarCatalogo();

    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==========================================================================
// INICIALIZACIÓN AL CARGAR LA PÁGINA
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
    cargarCatalogo();
});
