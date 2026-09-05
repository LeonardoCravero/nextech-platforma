// URL base de la API
const API_BASE_URL = 'http://localhost:8000';

// Estado global de la aplicación
const state = {
    productos: [],
    sucursales: [],
    productoSeleccionadoParaReserva: null,
    ultimaRecomendacionIA: null
};

// ==========================================
// NAVEGACIÓN Y UI
// ==========================================

document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        document.querySelectorAll('.seccion').forEach(s => {
            s.classList.remove('activa');
        });

        const targetId = e.target.getAttribute('data-target');
        document.getElementById(targetId).classList.add('activa');
    });
});

document.getElementById('sucursal-global').addEventListener('change', (e) => {
    renderProductos(state.productos, e.target.value);
});

function showToast(mensaje, tipo = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.textContent = mensaje;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3500);
}

// ==========================================
// SECCIÓN 1: CATÁLOGO Y SUCURSALES
// ==========================================

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
        console.warn('Backend no disponible para sucursales, usando sucursales por defecto.');
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
    loadingEl.style.display = 'block';

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

            loadingEl.style.display = 'none';
            renderProductos(state.productos, document.getElementById('sucursal-global').value);
            return;
        }
    } catch (error) {
        console.warn('Conexión con backend falló, usando datos locales:', error);
    }

    state.productos = [
        { id: 1, nombre: "Notebook Dell XPS 15", categoria: "Laptops", precio: 2500, stock: { 1: 5, 2: 0, 3: 12, 4: 8 } },
        { id: 2, nombre: "Monitor LG UltraWide 34\"", categoria: "Monitores", precio: 850, stock: { 1: 3, 2: 15, 3: 0, 4: 6 } },
        { id: 3, nombre: "Teclado Mecánico Keychron K2", categoria: "Periféricos", precio: 120, stock: { 1: 10, 2: 20, 3: 5, 4: 0 } }
    ];
    loadingEl.style.display = 'none';
    renderProductos(state.productos, document.getElementById('sucursal-global').value);
}

function renderProductos(productos, sucursalFiltro) {
    const grilla = document.getElementById('grilla-productos');
    grilla.innerHTML = '';

    if (productos.length === 0) {
        grilla.innerHTML = '<p class="text-sm">No hay productos disponibles actualmente.</p>';
        return;
    }

    productos.forEach(prod => {
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
            <button class="btn btn-outline btn-block" ${totalStock === 0 ? 'disabled' : ''} onclick="iniciarReserva(${prod.id})">
                ${totalStock === 0 ? 'Sin Stock' : 'Reservar'}
            </button>
        `;
        grilla.appendChild(card);
    });
}

// ==========================================
// SECCIÓN NUEVA: ASISTENTE IA
// ==========================================

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
        showToast('Por favor escribe tu consulta para la IA', 'error');
        return;
    }

    const btn = document.getElementById('btn-consultar-ia');
    btn.disabled = true;
    btn.textContent = 'Analizando stock...';

    // Obtener sucursal activa en el selector si hay una fija
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

        // Renderizar resultado visible de la IA
        const container = document.getElementById('ia-resultado');
        container.style.display = 'block';

        document.getElementById('ia-modelo-nombre').textContent = data.modelo_utilizado;
        document.getElementById('ia-sucursal-nombre').textContent = `Sucursal: ${data.sucursal_nombre}`;
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
                        <span>✓ ${p.stock_disponible} disponibles en ${p.sucursal_nombre}</span>
                    </div>
                </div>
            `;
            prodsGrilla.appendChild(card);
        });

        document.getElementById('ia-total-monto').textContent = `$${Number(data.total).toLocaleString('es-AR')}`;

        showToast('Recomendación generada con stock validado', 'success');

    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Preguntar a la IA';
    }
}

// Botón de 1-clic para reservar la recomendación de la IA
document.getElementById('btn-ia-reservar').addEventListener('click', () => {
    if (!state.ultimaRecomendacionIA || !state.ultimaRecomendacionIA.productos.length) {
        showToast('No hay productos recomendados para reservar', 'error');
        return;
    }

    const primerProd = state.ultimaRecomendacionIA.productos[0];
    const sucursalId = state.ultimaRecomendacionIA.sucursal_id;

    // Iniciar flujo de reserva
    iniciarReserva(primerProd.id, sucursalId);
    showToast(`Preparando reserva en ${state.ultimaRecomendacionIA.sucursal_nombre}`, 'info');
});

// ==========================================
// SECCIÓN 2: RESERVA ATÓMICA
// ==========================================

function iniciarReserva(productoId, sucursalPreseleccionada = null) {
    const producto = state.productos.find(p => p.id === productoId);
    if (!producto) return;

    state.productoSeleccionadoParaReserva = producto;

    document.querySelector('[data-target="seccion-reserva"]').click();

    document.getElementById('producto-seleccionado-info').innerHTML = `
        <h3 class="producto-nombre">${producto.nombre}</h3>
        <p class="producto-categoria">${producto.categoria || ''}</p>
        <p class="producto-precio">$${Number(producto.precio).toLocaleString('es-AR')}</p>
    `;

    document.getElementById('form-reserva').style.display = 'block';
    document.getElementById('reserva-producto-id').value = producto.id;

    const selectSucursal = document.getElementById('reserva-sucursal');
    selectSucursal.innerHTML = '';
    let primeraConStock = null;

    state.sucursales.forEach(suc => {
        const stock = (producto.stock && producto.stock[suc.id]) || 0;
        if (stock > 0) {
            if (!primeraConStock) primeraConStock = suc.id;
            const option = document.createElement('option');
            option.value = suc.id;
            option.textContent = `${suc.nombre} (${stock} disp.)`;
            option.dataset.max = stock;
            if (sucursalPreseleccionada && String(suc.id) === String(sucursalPreseleccionada)) {
                option.selected = true;
                primeraConStock = suc.id;
            }
            selectSucursal.appendChild(option);
        }
    });

    actualizarMaxCantidad();
}

document.getElementById('reserva-sucursal').addEventListener('change', actualizarMaxCantidad);

function actualizarMaxCantidad() {
    const select = document.getElementById('reserva-sucursal');
    const inputCant = document.getElementById('reserva-cantidad');
    const infoSpan = document.getElementById('max-stock-info');
    
    if (select.selectedOptions.length > 0) {
        const max = parseInt(select.selectedOptions[0].dataset.max) || 1;
        inputCant.max = max;
        if (parseInt(inputCant.value) > max) {
            inputCant.value = max;
        }
        infoSpan.textContent = `Máximo disponible para retiro: ${max}`;
    }
}

document.getElementById('form-reserva').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const productoId = parseInt(document.getElementById('reserva-producto-id').value);
    const sucursalId = parseInt(document.getElementById('reserva-sucursal').value);
    const cantidad = parseInt(document.getElementById('reserva-cantidad').value);
    const email = document.getElementById('reserva-email').value.trim();

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

        document.getElementById('modal-orden-id').textContent = `ORD-${data.orden_id}`;
        document.getElementById('modal-pin').textContent = data.pin;
        document.getElementById('modal-vencimiento').textContent = new Date(data.vencimiento).toLocaleString('es-AR');
        document.getElementById('modal-reserva').classList.add('activo');
        
        showToast('Reserva creada exitosamente con bloqueo atómico (SELECT FOR UPDATE)', 'success');

        e.target.reset();
        document.getElementById('form-reserva').style.display = 'none';
        document.getElementById('producto-seleccionado-info').innerHTML = '<p>No hay producto seleccionado.</p>';

        cargarCatalogo();

    } catch (error) {
        showToast(error.message, 'error');
    }
});

document.getElementById('btn-cerrar-modal').addEventListener('click', () => {
    document.getElementById('modal-reserva').classList.remove('activo');
    document.querySelector('[data-target="seccion-catalogo"]').click();
});

// ==========================================
// SECCIÓN 3: CONSULTAR Y RETIRAR ORDEN
// ==========================================

document.getElementById('btn-buscar-orden').addEventListener('click', async () => {
    let inputVal = document.getElementById('buscar-orden-id').value.trim();
    if (!inputVal) {
        showToast('Ingresa un ID de orden', 'error');
        return;
    }

    const ordenId = parseInt(inputVal.replace(/^ORD-/i, ''));
    if (isNaN(ordenId)) {
        showToast('Formato de orden inválido', 'error');
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
            <p><strong>Estado:</strong> <span class="badge ${orden.estado}">${orden.estado.toUpperCase()}</span></p>
            <p><strong>Sucursal de Retiro:</strong> ${sucursal.nombre}</p>
            <p><strong>Total:</strong> $${Number(orden.total).toLocaleString('es-AR')}</p>
            <p><strong>Fecha creación:</strong> ${new Date(orden.fecha_creacion).toLocaleString('es-AR')}</p>
            <div class="mt-20">
                <strong>Artículos:</strong>
                <ul>${itemsHtml}</ul>
            </div>
            
            ${(orden.estado === 'reservada' || orden.estado === 'lista_retiro') ? `
                <div class="mt-20 info-box">
                    <label><strong>Confirmar Retiro en Mostrador</strong></label>
                    <div class="search-bar mt-20" style="margin-top: 10px;">
                        <input type="text" id="pin-retiro" class="form-input" placeholder="Ingresa PIN de 6 dígitos">
                        <button onclick="confirmarRetiro(${orden.id})" class="btn btn-primary">Validar y Retirar</button>
                    </div>
                </div>
            ` : ''}
        `;

    } catch (error) {
        showToast(error.message, 'error');
        document.getElementById('orden-resultado').style.display = 'none';
    }
});

async function confirmarRetiro(ordenId) {
    const pin = document.getElementById('pin-retiro').value.trim();
    if (!pin) {
        showToast('Ingresa el PIN de seguridad', 'error');
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

        showToast('¡Retiro confirmado exitosamente! Stock descontado permanentemente.', 'success');
        document.getElementById('orden-resultado').style.display = 'none';
        document.getElementById('buscar-orden-id').value = '';
        
        cargarCatalogo();

    } catch (error) {
        showToast(error.message, 'error');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    cargarCatalogo();
});
