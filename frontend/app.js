// URL base de la API (usa el origen actual o localhost:8000 por defecto)
const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin.startsWith('http')) ? window.location.origin : 'http://localhost:8000';

// Estado global de la aplicacion
const state = {
    productos: [],
    sucursales: [],
    categoriaActiva: 'todos',
    productoParaModal: null,
    ultimaRecomendacionIA: null,
    usuario: null  // { token, role, nombre }
};

// ==========================================================================
// AUTH HELPERS
// ==========================================================================
function decodeJWT(token) {
    try { return JSON.parse(atob(token.split('.')[1])); } catch(e) { return null; }
}
function getAuthHeaders() {
    const t = state.usuario ? state.usuario.token : null;
    if (!t) return {'Content-Type':'application/json'};
    return {'Content-Type':'application/json','Authorization':'Bearer '+t};
}
function cargarSesionGuardada() {
    // Buscar primero en sessionStorage (sesion de la pestaña), luego en localStorage (sesion recordada)
    const token = sessionStorage.getItem('nextech_token') || localStorage.getItem('nextech_token');
    if (token) {
        const p = decodeJWT(token);
        if (p && p.exp * 1000 > Date.now()) {
            const nombreMostrar = p.nombre || (p.email ? p.email.split('@')[0] : ('Usuario #' + p.sub));
            state.usuario = { token, role: p.role, nombre: nombreMostrar, email: p.email };
        } else {
            localStorage.removeItem('nextech_token');
            sessionStorage.removeItem('nextech_token');
        }
    }
}
function cerrarSesion() {
    localStorage.removeItem('nextech_token');
    sessionStorage.removeItem('nextech_token');
    state.usuario = null;
    const lista = document.getElementById('mis-ordenes-lista');
    if (lista) lista.innerHTML = '';
    const resBusqueda = document.getElementById('buscar-orden-resultado');
    if (resBusqueda) { resBusqueda.style.display = 'none'; resBusqueda.innerHTML = ''; }
    const inputBuscar = document.getElementById('buscar-orden-id');
    if (inputBuscar) inputBuscar.value = '';
    aplicarVisibilidad();
    showToast('Sesion cerrada.', 'info');
    document.querySelector('[data-target="seccion-catalogo"]').click();
}

// ==========================================================================
// AUTH MODAL
// ==========================================================================
function setupBackdropClose(modalId, closeFn) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    let clickStartedOnBackdrop = false;
    modal.addEventListener('mousedown', (e) => {
        // Solo es verdadero si se hizo clic exactamente sobre el fondo/backdrop (no sus hijos)
        clickStartedOnBackdrop = (e.target === modal);
    });
    modal.addEventListener('mouseup', (e) => {
        // Solo cerramos si TANTO el inicio (mousedown) como el fin (mouseup) ocurrieron en el backdrop
        if (clickStartedOnBackdrop && e.target === modal) {
            closeFn();
        }
        clickStartedOnBackdrop = false;
    });
}

function abrirAuthModal() { document.getElementById('modal-auth').classList.add('activo'); }
function cerrarAuthModal() { document.getElementById('modal-auth').classList.remove('activo'); }
setupBackdropClose('modal-auth', cerrarAuthModal);
function switchAuthTab(tabId) {
    document.querySelectorAll('.auth-tab-content').forEach(t => t.style.display='none');
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).style.display='block';
    document.querySelector('.auth-tab[data-tab="'+tabId+'"]').classList.add('active');
}
async function submitLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const recordar = document.getElementById('login-recordar') ? document.getElementById('login-recordar').checked : false;
    if (!email || !password) { showToast('Completa todos los campos.','error'); return; }
    try {
        const res = await fetch(API_BASE_URL+'/api/auth/login', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({email, password})
        });
        if (!res.ok) { const err = await res.json().catch(()=>({detail:'Error'})); throw new Error(err.detail||'Credenciales invalidas'); }
        const data = await res.json();
        const payload = decodeJWT(data.access_token);
        const nombreMostrar = data.nombre || (payload ? payload.nombre : null) || email.split('@')[0];
        state.usuario = { token: data.access_token, role: data.role || payload.role, nombre: nombreMostrar, email };
        
        if (recordar) {
            localStorage.setItem('nextech_token', data.access_token);
            sessionStorage.removeItem('nextech_token');
        } else {
            sessionStorage.setItem('nextech_token', data.access_token);
            localStorage.removeItem('nextech_token');
        }

        // Limpiar búsquedas previas de órdenes
        const resBusqueda = document.getElementById('buscar-orden-resultado');
        if (resBusqueda) { resBusqueda.style.display = 'none'; resBusqueda.innerHTML = ''; }
        const inputBuscar = document.getElementById('buscar-orden-id');
        if (inputBuscar) inputBuscar.value = '';
        cerrarAuthModal();
        aplicarVisibilidad();
        showToast('Bienvenido/a ' + nombreMostrar + '! Rol: ' + (data.role || payload.role), 'success');
        if ((data.role || payload.role) === 'empleado') { cargarInventarioEmpleado(); cargarTodasLasOrdenes(); }
        if ((data.role || payload.role) === 'cliente') { cargarMisOrdenes(); }
    } catch(e) { showToast(e.message,'error'); }
}
async function submitRegister() {
    const nombre = document.getElementById('reg-nombre').value.trim();
    const apellido = document.getElementById('reg-apellido').value.trim();
    const telefono = document.getElementById('reg-telefono').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const rol = document.querySelector('input[name="reg-rol"]:checked').value;
    if (!nombre||!apellido||!telefono||!email||!password) { showToast('Completa todos los campos.','error'); return; }
    if (password.length < 8) { showToast('La contrasena debe tener al menos 8 caracteres.','error'); return; }
    try {
        const res = await fetch(API_BASE_URL+'/api/auth/register', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({nombre,apellido,telefono,email,password,rol})
        });
        if (!res.ok) { const err = await res.json().catch(()=>({detail:'Error'})); throw new Error(err.detail||'Error al registrar'); }
        showToast('Cuenta creada! Ahora podes iniciar sesion.','success');
        switchAuthTab('tab-login');
    } catch(e) { showToast(e.message,'error'); }
}

// ==========================================================================
// VISIBILIDAD POR ROL
// ==========================================================================
function aplicarVisibilidad() {
    const role = state.usuario ? state.usuario.role : null;
    const btnOpen = document.getElementById('btn-open-auth');
    const btnLogout = document.getElementById('btn-logout');
    const labelUser = document.getElementById('auth-user-label');
    if (state.usuario) {
        btnOpen.style.display='none';
        btnLogout.style.display='inline-block';
        labelUser.style.display='inline-block';
        labelUser.textContent = state.usuario.nombre+' ('+state.usuario.role+')';
    } else {
        btnOpen.style.display='inline-block';
        btnLogout.style.display='none';
        labelUser.style.display='none';
    }
    document.querySelectorAll('[data-protected]').forEach(el => {
        el.style.display = (role === el.getAttribute('data-protected')) ? '' : 'none';
    });
    // re-render productos para actualizar botones de reserva segun rol
    if (state.productos.length) {
        renderProductos(state.productos, document.getElementById('sucursal-global').value);
    }
}

// ==========================================================================
// NAVEGACION
// ==========================================================================
document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        document.querySelectorAll('.seccion').forEach(s => s.classList.remove('activa'));
        const targetId = e.target.getAttribute('data-target');
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
            targetEl.classList.add('activa');
            window.scrollTo({top:0,behavior:'smooth'});
            const globalSuc = document.getElementById('sucursal-global')?.value || 'todas';
            if (targetId==='seccion-inventario' && state.usuario && state.usuario.role==='empleado') {
                const invSel = document.getElementById('inv-filtro-sucursal');
                if (invSel) invSel.value = globalSuc;
                cargarInventarioEmpleado();
            }
            if (targetId==='seccion-todas-ordenes' && state.usuario && state.usuario.role==='empleado') {
                const ordSel = document.getElementById('ord-filtro-sucursal');
                if (ordSel) ordSel.value = globalSuc;
                cargarTodasLasOrdenes();
            }
            if (targetId==='seccion-ordenes' && state.usuario && state.usuario.role==='cliente') cargarMisOrdenes();
        }
    });
});
document.getElementById('sucursal-global').addEventListener('change', (e) => {
    const val = e.target.value;
    renderProductos(state.productos, val);

    // Sincronizar selectores de filtros de empleado si existen
    const invSel = document.getElementById('inv-filtro-sucursal');
    if (invSel) invSel.value = val;
    const ordSel = document.getElementById('ord-filtro-sucursal');
    if (ordSel) ordSel.value = val;

    // Si el empleado está actualmente en esa sección, refrescar vista
    const seccionActiva = document.querySelector('.seccion.activa')?.id;
    if (seccionActiva === 'seccion-inventario' && state.usuario?.role === 'empleado') {
        cargarInventarioEmpleado();
    } else if (seccionActiva === 'seccion-todas-ordenes' && state.usuario?.role === 'empleado') {
        filtrarOrdenes();
    }
});
function cerrarModal(modalId) { document.getElementById(modalId).classList.remove('activo'); }
setupBackdropClose('modal-confirmar-retiro', () => cerrarModal('modal-confirmar-retiro'));
setupBackdropClose('modal-producto-form', () => cerrarModal('modal-producto-form'));
setupBackdropClose('modal-detalle-orden', () => cerrarModal('modal-detalle-orden'));

// ==========================================================================
// TOAST
// ==========================================================================
function showToast(mensaje, tipo='info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast '+tipo;
    toast.textContent = mensaje;
    container.appendChild(toast);
    setTimeout(()=>toast.remove(), 3800);
}

// ==========================================================================
// CATALOGO
// ==========================================================================
async function cargarSucursales() {
    try {
        const res = await fetch(API_BASE_URL+'/api/sucursales');
        if (res.ok) {
            state.sucursales = await res.json();
            const optHtml = state.sucursales.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
            const sel = document.getElementById('sucursal-global');
            sel.innerHTML = '<option value="todas">Todas las sucursales</option>' + optHtml;
            // Populate employee filter selectors too
            const invSel = document.getElementById('inv-filtro-sucursal');
            if (invSel) invSel.innerHTML = '<option value="todas">Todas las sucursales</option>' + optHtml;
            const ordSel = document.getElementById('ord-filtro-sucursal');
            if (ordSel) ordSel.innerHTML = '<option value="todas">Todas</option>' + optHtml;
        }
    } catch(e) {
        state.sucursales = [
            {id:1,nombre:"Central Obelisco"},{id:2,nombre:"Palermo Soho"},
            {id:3,nombre:"Belgrano Tech"},{id:4,nombre:"Zona Norte Martinez"}
        ];
    }
}
async function cargarCatalogo() {
    const loadingEl = document.getElementById('loading-catalogo');
    if (loadingEl) loadingEl.style.display='block';
    try {
        await cargarSucursales();
        const [resProd,resStock] = await Promise.all([
            fetch(API_BASE_URL+'/api/productos'),
            fetch(API_BASE_URL+'/api/stock')
        ]);
        if (resProd.ok && resStock.ok) {
            const productos = await resProd.json();
            const stocks = await resStock.json();
            state.productos = productos.map(p => {
                const stockMap = {};
                state.sucursales.forEach(suc => {
                    const s = stocks.find(s=>s.producto_id===p.id && s.sucursal_id===suc.id);
                    stockMap[suc.id] = s ? s.stock_disponible : 0;
                });
                return {...p, stock:stockMap};
            });
            if (loadingEl) loadingEl.style.display='none';
            renderProductos(state.productos, document.getElementById('sucursal-global').value);
            return;
        }
    } catch(e) { console.warn('Usando datos locales:', e); }
    state.productos = [
        {id:1,nombre:"Notebook Dell XPS 15",categoria:"Laptops",precio:2500,stock:{1:5,2:0,3:12,4:8}},
        {id:2,nombre:"Notebook ThinkPad T14",categoria:"Laptops",precio:1400,stock:{1:15,2:4,3:6,4:10}},
        {id:3,nombre:"Monitor LG UltraWide 34\"",categoria:"Monitores",precio:850,stock:{1:3,2:15,3:0,4:6}},
        {id:4,nombre:"Teclado Keychron K2",categoria:"Perifericos",precio:120,stock:{1:10,2:20,3:5,4:0}},
        {id:5,nombre:"Mouse Logitech MX Master 3S",categoria:"Perifericos",precio:100,stock:{1:18,2:7,3:12,4:15}},
        {id:6,nombre:"Auriculares Sony WH-1000XM5",categoria:"Audio",precio:350,stock:{1:8,2:0,3:4,4:2}},
        {id:7,nombre:"Disco SSD Samsung 980 Pro 2TB",categoria:"Componentes",precio:200,stock:{1:25,2:14,3:10,4:18}},
        {id:8,nombre:"Memoria RAM Corsair 32GB DDR5",categoria:"Componentes",precio:150,stock:{1:30,2:22,3:15,4:8}}
    ];
    if (loadingEl) loadingEl.style.display='none';
    renderProductos(state.productos, document.getElementById('sucursal-global').value);
}
function filtrarPorTag(categoria, btnElement) {
    state.categoriaActiva = categoria;
    document.querySelectorAll('.filtro-btn').forEach(b=>b.classList.remove('activo'));
    if (btnElement) btnElement.classList.add('activo');
    renderProductos(state.productos, document.getElementById('sucursal-global').value);
}
function filtrarCategoria(categoria) {
    document.querySelectorAll('.filtro-btn').forEach(b => {
        if (b.textContent.toLowerCase()===categoria.toLowerCase()) b.classList.add('activo');
        else b.classList.remove('activo');
    });
    filtrarPorTag(categoria, null);
    const h = document.getElementById('catalogo-heading');
    if (h) h.scrollIntoView({behavior:'smooth'});
}
function renderProductos(productos, sucursalFiltro) {
    const grilla = document.getElementById('grilla-productos');
    if (!grilla) return;
    grilla.innerHTML = '';
    let list = productos;
    if (state.categoriaActiva !== 'todos') {
        list = productos.filter(p => p.categoria && p.categoria.toLowerCase()===state.categoriaActiva.toLowerCase());
    }
    if (!list.length) { grilla.innerHTML = '<p class="text-sm text-muted">No hay productos en esta categoria.</p>'; return; }
    const esCliente = state.usuario && state.usuario.role === 'cliente';
    list.forEach(prod => {
        const card = document.createElement('div');
        card.className = 'card producto-card';
        let chipsHtml = '';
        state.sucursales.forEach(suc => {
            if (sucursalFiltro !== 'todas' && String(sucursalFiltro) !== String(suc.id)) return;
            const qty = (prod.stock && prod.stock[suc.id]!==undefined) ? prod.stock[suc.id] : 0;
            let sc='stock-out', ic='x';
            if (qty>5){sc='stock-ok';ic='v';}
            else if(qty>0){sc='stock-low';ic='!';}
            chipsHtml += '<div class="chip '+sc+'"><span>'+suc.nombre+'</span><span>'+qty+' '+ic+'</span></div>';
        });
        const total = prod.stock ? Object.values(prod.stock).reduce((a,b)=>a+b,0) : 0;
        const btnHtml = esCliente
            ? '<button class="btn btn-outline btn-block"'+(total===0?' disabled':'')+' onclick="abrirModalReserva('+prod.id+')">'+(total===0?'Sin Stock':'&#9889; Reservar (Click &amp; Collect)')+'</button>'
            : (state.usuario && state.usuario.role==='empleado'
                ? '<button class="btn btn-outline btn-block" disabled title="Cuenta de empleado (modo gestión)" style="opacity:0.4;cursor:not-allowed;">Cuenta Empleado</button>'
                : '<button class="btn btn-outline btn-block" onclick="abrirAuthModal()" title="Iniciá sesión como cliente para reservar">&#9889; Reservar (Iniciar Sesión)</button>');
        card.innerHTML = '<div><h3 class="producto-nombre">'+prod.nombre+'</h3><p class="producto-categoria">'+(prod.categoria||'Hardware')+'</p><p class="producto-precio">$'+Number(prod.precio).toLocaleString('es-AR')+'</p><div class="stock-chips">'+chipsHtml+'</div></div>'+btnHtml;
        grilla.appendChild(card);
    });
}

// ==========================================================================
// MODAL RESERVA
// ==========================================================================
function abrirModalReserva(productoId, sucursalPreseleccionada=null) {
    if (!state.usuario || state.usuario.role !== 'cliente') {
        showToast('Debes iniciar sesion como cliente para reservar.','error');
        abrirAuthModal(); return;
    }
    const producto = state.productos.find(p=>p.id===productoId);
    if (!producto) return;
    state.productoParaModal = producto;
    document.getElementById('modal-producto-id').value = producto.id;
    document.getElementById('modal-prod-nombre').textContent = producto.nombre;
    document.getElementById('modal-prod-categoria').textContent = producto.categoria||'Hardware';
    document.getElementById('modal-prod-precio').textContent = '$'+Number(producto.precio).toLocaleString('es-AR');
    const selectSucursal = document.getElementById('modal-reserva-sucursal');
    selectSucursal.innerHTML = '';
    let primeraConStock = null;
    state.sucursales.forEach(suc => {
        const stock = (producto.stock && producto.stock[suc.id]) || 0;
        if (stock>0) {
            if (!primeraConStock) primeraConStock=suc.id;
            const o = document.createElement('option');
            o.value=suc.id; o.textContent=suc.nombre+' ('+stock+' un. disponibles)'; o.dataset.max=stock;
            if (sucursalPreseleccionada && String(suc.id)===String(sucursalPreseleccionada)){o.selected=true;primeraConStock=suc.id;}
            selectSucursal.appendChild(o);
        }
    });
    if (!primeraConStock){showToast('Sin stock disponible en ninguna sucursal','error');return;}
    document.getElementById('modal-reserva-cantidad').value=1;
    actualizarMaxCantidadModal();
    document.getElementById('modal-flujo-reserva').classList.add('activo');
}
document.getElementById('btn-cerrar-modal-reserva').addEventListener('click',cerrarModalReserva);
setupBackdropClose('modal-flujo-reserva', cerrarModalReserva);
function cerrarModalReserva(){document.getElementById('modal-flujo-reserva').classList.remove('activo');}
document.getElementById('modal-reserva-sucursal').addEventListener('change',actualizarMaxCantidadModal);
document.getElementById('modal-reserva-cantidad').addEventListener('input',recalcularSubtotalModal);
document.getElementById('qty-btn-minus').addEventListener('click',()=>{
    const i=document.getElementById('modal-reserva-cantidad');
    let v=parseInt(i.value)||1;if(v>1){i.value=v-1;recalcularSubtotalModal();}
});
document.getElementById('qty-btn-plus').addEventListener('click',()=>{
    const i=document.getElementById('modal-reserva-cantidad');
    const m=parseInt(i.max)||100;let v=parseInt(i.value)||1;if(v<m){i.value=v+1;recalcularSubtotalModal();}
});
function actualizarMaxCantidadModal(){
    const sel=document.getElementById('modal-reserva-sucursal');
    const inp=document.getElementById('modal-reserva-cantidad');
    if(sel.selectedOptions.length>0){
        const max=parseInt(sel.selectedOptions[0].dataset.max)||1;
        inp.max=max;if(parseInt(inp.value)>max)inp.value=max;
        document.getElementById('modal-max-stock-info').textContent='Stock disponible: '+max+' un.';
        document.getElementById('modal-sucursal-hint').textContent='Retiro en '+sel.selectedOptions[0].text.split('(')[0].trim();
    }
    recalcularSubtotalModal();
}
function recalcularSubtotalModal(){
    if(!state.productoParaModal)return;
    const c=parseInt(document.getElementById('modal-reserva-cantidad').value)||1;
    document.getElementById('modal-resumen-subtotal').textContent='$'+(c*Number(state.productoParaModal.precio)).toLocaleString('es-AR');
}
document.getElementById('form-reserva-modal').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const btn=document.getElementById('btn-submit-reserva');
    btn.disabled=true;btn.textContent='Bloqueando stock...';
    const productoId=parseInt(document.getElementById('modal-producto-id').value);
    const sucursalId=parseInt(document.getElementById('modal-reserva-sucursal').value);
    const cantidad=parseInt(document.getElementById('modal-reserva-cantidad').value);
    try{
        const res=await fetch(API_BASE_URL+'/api/reservas',{
            method:'POST',headers:getAuthHeaders(),
            body:JSON.stringify({sucursal_id:sucursalId,items:[{producto_id:productoId,cantidad}]})
        });
        if(!res.ok){const err=await res.json().catch(()=>({detail:'Error'}));throw new Error(err.detail||'Error al reservar');}
        const data=await res.json();
        cerrarModalReserva();
        document.getElementById('modal-exito-orden-id').textContent='ORD-'+data.orden_id;
        document.getElementById('modal-exito-pin').textContent=data.pin;
        document.getElementById('modal-exito-vencimiento').textContent=new Date(data.vencimiento).toLocaleString('es-AR');
        document.getElementById('modal-exito-reserva').classList.add('activo');
        showToast('Reserva confirmada!','success');
        cargarCatalogo();
    }catch(err){showToast(err.message,'error');}
    finally{btn.disabled=false;btn.textContent='Confirmar Reserva Atomica';}
});
document.getElementById('btn-copiar-pin').addEventListener('click',()=>{
    const pin=document.getElementById('modal-exito-pin').textContent;
    navigator.clipboard.writeText(pin).then(()=>showToast('PIN copiado!','success')).catch(()=>showToast('PIN: '+pin,'info'));
});
document.getElementById('btn-cerrar-exito').addEventListener('click',()=>{
    document.getElementById('modal-exito-reserva').classList.remove('activo');
    const inputBuscar = document.getElementById('buscar-orden-id');
    if (inputBuscar) inputBuscar.value = '';
    document.querySelector('[data-target="seccion-ordenes"]').click();
});

// ==========================================================================
// ASISTENTE IA
// ==========================================================================
function aplicarSugerencia(texto){document.getElementById('input-consulta-ia').value=texto;consultarAsistenteIA();}
document.getElementById('btn-consultar-ia').addEventListener('click',consultarAsistenteIA);
document.getElementById('input-consulta-ia').addEventListener('keydown',(e)=>{if(e.key==='Enter')consultarAsistenteIA();});
async function consultarAsistenteIA(){
    const input=document.getElementById('input-consulta-ia');
    const mensaje=input.value.trim();
    if(!mensaje){showToast('Escribe tu consulta','error');return;}
    const btn=document.getElementById('btn-consultar-ia');
    btn.disabled=true;btn.textContent='Analizando inventario...';
    const sv=document.getElementById('sucursal-global').value;
    const sucursalId=sv!=='todas'?parseInt(sv):null;
    try{
        const res=await fetch(API_BASE_URL+'/api/ia/consultar',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({mensaje,sucursal_id:sucursalId})
        });
        if(!res.ok)throw new Error('Error al consultar el asistente');
        const data=await res.json();
        state.ultimaRecomendacionIA=data;
        const container=document.getElementById('ia-resultado');
        container.style.display='block';
        document.getElementById('ia-modelo-nombre').textContent=data.modelo_utilizado;
        document.getElementById('ia-sucursal-nombre').textContent='Sucursal: '+data.sucursal_nombre;
        document.getElementById('ia-texto-salida').innerHTML=data.respuesta.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
        const grilla=document.getElementById('ia-productos-recomendados');
        grilla.innerHTML='';
        const esCliente=state.usuario&&state.usuario.role==='cliente';
        data.productos.forEach(p=>{
            const card=document.createElement('div');card.className='card producto-card';
            const btnR=esCliente
                ?'<button class="btn btn-outline btn-block mt-15" onclick="abrirModalReserva('+p.id+','+p.sucursal_id+')">Reservar</button>'
                :'<button class="btn btn-outline btn-block mt-15" disabled style="opacity:0.4;">Inicia sesion para reservar</button>';
            card.innerHTML='<div><h3 class="producto-nombre">'+p.nombre+'</h3><p class="producto-categoria">'+p.categoria+'</p><p class="producto-precio">$'+Number(p.precio).toLocaleString('es-AR')+'</p><div class="chip stock-ok mt-20" style="display:inline-block;"><span>✓ '+p.stock_disponible+' disp. en '+p.sucursal_nombre+'</span></div></div>'+btnR;
            grilla.appendChild(card);
        });
        document.getElementById('ia-total-monto').textContent='$'+Number(data.total).toLocaleString('es-AR');
        showToast('Recomendacion generada!','success');
        container.scrollIntoView({behavior:'smooth'});
    }catch(e){showToast(e.message,'error');}
    finally{btn.disabled=false;btn.textContent='Consultar Asistente';}
}
document.getElementById('btn-ia-reservar').addEventListener('click',()=>{
    if(!state.ultimaRecomendacionIA||!state.ultimaRecomendacionIA.productos.length){showToast('Sin productos recomendados','error');return;}
    const p=state.ultimaRecomendacionIA.productos[0];
    abrirModalReserva(p.id,state.ultimaRecomendacionIA.sucursal_id);
});

// ==========================================================================
// CLIENTE: MIS ORDENES
// ==========================================================================
async function cargarMisOrdenes(){
    const listaDiv = document.getElementById('mis-ordenes-lista');
    if (!listaDiv) return;
    listaDiv.innerHTML = '<p class="text-muted">Cargando tus ordenes...</p>';
    try{
        const res = await fetch(API_BASE_URL+'/api/mis-ordenes', {headers: getAuthHeaders()});
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                listaDiv.innerHTML = '<p class="text-muted">Inicia sesion como cliente para ver tus reservas.</p>';
                return;
            }
            throw new Error('No se pudieron cargar las ordenes');
        }
        const ordenes = await res.json();
        if (!ordenes.length) {
            listaDiv.innerHTML = '<p class="text-muted">No tienes reservas activas con esta cuenta.</p>';
            return;
        }
        let html = '';
        ordenes.forEach(o => {
            const suc = state.sucursales.find(s=>s.id===o.sucursal_id) || {nombre: 'Sucursal #'+o.sucursal_id};
            const ec = o.estado === 'retirada' ? 'stock-ok' : o.estado === 'cancelada' ? 'stock-out' : 'stock-low';
            const btnVerProd = '<button class="btn btn-outline btn-sm mt-10" onclick="abrirModalDetalleOrden('+o.id+')" style="margin-right:8px;">📦 Ver Productos</button>';
            const btnCancel = (o.estado==='reservada'||o.estado==='lista_retiro') ? '<button class="btn btn-outline btn-sm mt-10" onclick="cancelarReserva('+o.id+')">Cancelar esta reserva</button>' : '';
            html += '<div class="card mb-20" style="border-left:4px solid var(--cyan);"><div style="display:flex;justify-content:space-between;align-items:center;"><h3>Orden ORD-'+o.id+'</h3><span class="chip '+ec+'" style="display:inline-block;">'+o.estado.toUpperCase()+'</span></div><p><strong>Sucursal:</strong> '+suc.nombre+'</p><p><strong>Total:</strong> $'+Number(o.total).toLocaleString('es-AR')+'</p><p><strong>Creada:</strong> '+(o.fecha_creacion?new Date(o.fecha_creacion).toLocaleString('es-AR'):'-')+'</p>'+(o.pin?'<div class="pin-display-card mt-10"><span class="pin-label">TU PIN</span><div class="pin-code">'+o.pin+'</div></div>':'')+'<div class="mt-10">'+btnVerProd+btnCancel+'</div></div>';
        });
        listaDiv.innerHTML = html;
    } catch(e) {
        listaDiv.innerHTML = '<p class="text-muted">'+e.message+'</p>';
    }
}

async function cancelarReserva(ordenId){
    if(!confirm('Estas seguro de cancelar esta reserva?'))return;
    const pinInput=prompt('Ingresa tu PIN para confirmar la cancelacion:');
    if(!pinInput)return;
    try{
        const res=await fetch(API_BASE_URL+'/api/ordenes/'+ordenId+'/cancelar',{
            method:'POST',headers:getAuthHeaders(),body:JSON.stringify({pin:pinInput})
        });
        if(!res.ok){const err=await res.json().catch(()=>({detail:'Error'}));throw new Error(err.detail);}
        showToast('Reserva cancelada.','success');cargarMisOrdenes();cargarCatalogo();
    }catch(e){showToast(e.message,'error');}
}

document.getElementById('btn-buscar-orden').addEventListener('click',async()=>{
    let v=document.getElementById('buscar-orden-id').value.trim();
    const resDiv=document.getElementById('buscar-orden-resultado');
    if(!v){showToast('Ingresa un ID de orden','error');return;}
    const id=parseInt(v.replace(/^ORD-/i,''));
    if(isNaN(id)){showToast('Formato invalido','error');return;}
    try{
        const res=await fetch(API_BASE_URL+'/api/ordenes/'+id, {headers: getAuthHeaders()});
        if(res.status === 403) throw new Error('Esta orden no pertenece a tu cuenta');
        if(!res.ok) throw new Error('Orden no encontrada');
        const o=await res.json();
        const suc=state.sucursales.find(s=>s.id===o.sucursal_id)||{nombre:'Sucursal #'+o.sucursal_id};
        const items=o.items.map(it=>'<li>Producto #'+it.producto_id+' - Cant: '+it.cantidad+' ($'+Number(it.precio_unitario).toLocaleString('es-AR')+' c/u)</li>').join('');
        resDiv.style.display='block';
        resDiv.innerHTML='<h3>Orden #ORD-'+o.id+'</h3><p><strong>Estado:</strong> <span class="chip '+(o.estado==='retirada'?'stock-ok':'stock-low')+'" style="display:inline-block;margin-left:5px;">'+o.estado.toUpperCase()+'</span></p><p><strong>Sucursal:</strong> '+suc.nombre+'</p><p><strong>Total:</strong> $'+Number(o.total).toLocaleString('es-AR')+'</p><p><strong>Creada:</strong> '+new Date(o.fecha_creacion).toLocaleString('es-AR')+'</p><div class="mt-20"><strong>Articulos:</strong><ul style="margin-left:20px;margin-top:5px;">'+items+'</ul></div>';
    }catch(e){showToast(e.message,'error');if(resDiv)resDiv.style.display='none';}
});

// ==========================================================================
// EMPLEADO: INVENTARIO
// ==========================================================================
async function cargarInventarioEmpleado(){
    const tbody=document.getElementById('tbody-inventario');
    if(!tbody)return;
    tbody.innerHTML='<tr><td colspan="8" class="text-center text-muted">Cargando...</td></tr>';
    try{
        const selSuc = document.getElementById('inv-filtro-sucursal')?.value || document.getElementById('sucursal-global')?.value || 'todas';
        const url = (selSuc && selSuc !== 'todas') 
            ? `${API_BASE_URL}/api/inventario?sucursal_id=${selSuc}` 
            : `${API_BASE_URL}/api/inventario`;
        const res=await fetch(url,{headers:getAuthHeaders()});
        if(!res.ok)throw new Error('No se pudo cargar el inventario');
        let items=await res.json();
        if (selSuc && selSuc !== 'todas') {
            items = items.filter(it => String(it.sucursal_id) === String(selSuc));
        }
        if(!items.length){tbody.innerHTML='<tr><td colspan="8" class="text-center text-muted">Sin datos para la sucursal seleccionada.</td></tr>';return;}
        tbody.innerHTML=items.map(item=>'<tr><td>'+( item.producto_nombre||'-')+'</td><td><code>'+(item.sku||'-')+'</code></td><td>'+(item.categoria||'-')+'</td><td>$'+Number(item.precio||0).toLocaleString('es-AR')+'</td><td>'+(item.sucursal_nombre||'-')+'</td><td class="'+(item.stock_disponible<=item.stock_minimo?'text-red':'text-green')+'">'+item.stock_disponible+'</td><td>'+item.stock_reservado+'</td><td><button class="btn btn-outline btn-sm" onclick="abrirEditarProducto('+item.producto_id+',\''+( item.producto_nombre||'').replace(/'/g,"\\'")+'\',\''+(item.categoria||'').replace(/'/g,"\\'")+'\','+( item.precio||0)+')">Editar</button> <button class="btn btn-sm" style="background:#e53e3e;color:#fff;" onclick="eliminarProducto('+item.producto_id+')">Eliminar</button></td></tr>').join('');
    }catch(e){tbody.innerHTML='<tr><td colspan="8" class="text-center text-muted">'+e.message+'</td></tr>';}
}
function abrirModalNuevoProducto(){
    document.getElementById('modal-producto-titulo').textContent='Nuevo Producto';
    ['prod-form-id','prod-form-nombre','prod-form-descripcion','prod-form-categoria','prod-form-precio','prod-form-sku'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('prod-form-sku').disabled=false;

    // Mostrar tabla de stock inicial, ocultar la de edición
    document.getElementById('prod-form-stock-nuevo').style.display='block';
    document.getElementById('prod-form-stock-editar').style.display='none';

    // Poblar filas de sucursales con checkboxes para seleccionar en cuáles se venderá
    const tbody=document.getElementById('prod-form-stock-nuevo-tbody');
    const sucursales = state.sucursales && state.sucursales.length ? state.sucursales : [];
    if(sucursales.length){
        tbody.innerHTML=sucursales.map((s, idx)=>
            `<tr>
                <td style="padding:6px 4px;text-align:center;">
                    <input type="checkbox" id="stock-nuevo-check-${s.id}" ${idx===0 ? 'checked' : ''}
                        onchange="toggleStockInputs(${s.id})"
                        style="width:16px;height:16px;cursor:pointer;accent-color:var(--cyan);">
                </td>
                <td style="padding:6px 8px;font-weight:500;">${s.nombre}</td>
                <td style="padding:6px 8px;text-align:center;">
                    <input type="number" min="1" value="${idx===0 ? 5 : 0}"
                        id="stock-nuevo-disp-${s.id}"
                        ${idx===0 ? '' : 'disabled'}
                        oninput="onStockInputChanged(${s.id})"
                        class="form-input" style="width:70px;text-align:center;padding:4px 6px;">
                </td>
                <td style="padding:6px 8px;text-align:center;">
                    <input type="number" min="1" value="2"
                        id="stock-nuevo-min-${s.id}"
                        ${idx===0 ? '' : 'disabled'}
                        class="form-input" style="width:70px;text-align:center;padding:4px 6px;">
                </td>
            </tr>`
        ).join('');
    } else {
        tbody.innerHTML='<tr><td colspan="4" style="padding:6px 8px;color:var(--text-muted);">No se pudieron cargar las sucursales.</td></tr>';
    }

    document.getElementById('modal-producto-form').classList.add('activo');
}

function toggleStockInputs(sucursalId) {
    const chk = document.getElementById('stock-nuevo-check-' + sucursalId);
    const disp = document.getElementById('stock-nuevo-disp-' + sucursalId);
    const min = document.getElementById('stock-nuevo-min-' + sucursalId);
    if (!chk || !disp || !min) return;
    if (chk.checked) {
        disp.disabled = false;
        min.disabled = false;
        if (parseInt(disp.value) <= 0) disp.value = 5;
        disp.focus();
    } else {
        disp.disabled = true;
        min.disabled = true;
        disp.value = 0;
    }
}

function onStockInputChanged(sucursalId) {
    const chk = document.getElementById('stock-nuevo-check-' + sucursalId);
    const disp = document.getElementById('stock-nuevo-disp-' + sucursalId);
    if (!chk || !disp) return;
    if (parseInt(disp.value) > 0 && !chk.checked) {
        chk.checked = true;
    }
}

async function abrirEditarProducto(id, nombre, categoria, precio){
    document.getElementById('modal-producto-titulo').textContent='Editar Producto';
    document.getElementById('prod-form-id').value=id;
    document.getElementById('prod-form-nombre').value=nombre;
    document.getElementById('prod-form-categoria').value=categoria;
    document.getElementById('prod-form-precio').value=precio;
    document.getElementById('prod-form-sku').value='';
    document.getElementById('prod-form-sku').disabled=true;
    document.getElementById('prod-form-descripcion').value='';

    // Mostrar tabla de edición de stock, ocultar la de creación
    document.getElementById('prod-form-stock-nuevo').style.display='none';
    document.getElementById('prod-form-stock-editar').style.display='block';

    await recargarStockEditar(id);
    document.getElementById('modal-producto-form').classList.add('activo');
}

async function recargarStockEditar(productoId) {
    const tbody=document.getElementById('prod-form-stock-editar-tbody');
    tbody.innerHTML='<tr><td colspan="5" style="padding:6px 8px;color:var(--text-muted);">Cargando stock...</td></tr>';
    try{
        const res=await fetch(API_BASE_URL+'/api/inventario',{headers:getAuthHeaders()});
        if(!res.ok) throw new Error('Error al cargar inventario');
        const items=await res.json();
        const filas=items.filter(i=>i.producto_id===Number(productoId));
        
        if(!filas.length){
            tbody.innerHTML='<tr><td colspan="5" style="padding:6px 8px;color:var(--text-muted);">Sin stock en ninguna sucursal actualmente. Podés asignarlo abajo.</td></tr>';
        } else {
            tbody.innerHTML=filas.map(f=>
                `<tr id="inv-row-${f.inventario_id}">
                    <td style="padding:4px 8px;">${f.sucursal_nombre||'Sucursal #'+f.sucursal_id}</td>
                    <td style="padding:4px 8px;text-align:center;">
                        <input type="number" min="0" value="${f.stock_disponible}"
                            id="stock-edit-disp-${f.inventario_id}"
                            class="form-input" style="width:70px;text-align:center;padding:4px 6px;">
                    </td>
                    <td style="padding:4px 8px;text-align:center;color:var(--text-muted);">${f.stock_reservado}</td>
                    <td style="padding:4px 8px;text-align:center;">
                        <input type="number" min="0" value="${f.stock_minimo}"
                            id="stock-edit-min-${f.inventario_id}"
                            class="form-input" style="width:70px;text-align:center;padding:4px 6px;">
                    </td>
                    <td style="padding:4px 8px;text-align:center;white-space:nowrap;">
                        <button type="button" class="btn btn-outline btn-sm" onclick="guardarStockSucursal(${f.inventario_id})">
                            Guardar
                        </button>
                        <button type="button" class="btn btn-sm" style="background:#e53e3e;color:#fff;margin-left:4px;" title="Quitar de esta sucursal" onclick="quitarProductoSucursal(${f.inventario_id}, ${productoId})">
                            ✕
                        </button>
                    </td>
                </tr>`
            ).join('');
        }

        // Llenar selector de sucursales disponibles para agregar
        const selectNueva = document.getElementById('prod-form-nueva-sucursal');
        if (selectNueva) {
            const sucursalesYaAsignadas = new Set(filas.map(f=>f.sucursal_id));
            const disponibles = (state.sucursales||[]).filter(s=>!sucursalesYaAsignadas.has(s.id));
            if (disponibles.length) {
                selectNueva.innerHTML = disponibles.map(s=>`<option value="${s.id}">${s.nombre}</option>`).join('');
                document.getElementById('prod-form-agregar-sucursal-wrap').style.display='block';
            } else {
                document.getElementById('prod-form-agregar-sucursal-wrap').style.display='none';
            }
        }
    }catch(e){
        tbody.innerHTML=`<tr><td colspan="5" style="padding:6px 8px;color:var(--text-muted);">${e.message}</td></tr>`;
    }
}

async function guardarProducto(){
    const id=document.getElementById('prod-form-id').value;
    const nombre=document.getElementById('prod-form-nombre').value.trim();
    const descripcion=document.getElementById('prod-form-descripcion').value.trim();
    const categoria=document.getElementById('prod-form-categoria').value.trim();
    const precio=parseFloat(document.getElementById('prod-form-precio').value);
    const sku=document.getElementById('prod-form-sku').value.trim();
    if(!nombre||!precio){showToast('Nombre y precio son obligatorios.','error');return;}
    try{
        let res;
        if(id){
            // Edición: actualiza los datos del producto
            res=await fetch(API_BASE_URL+'/api/productos/'+id,{method:'PUT',headers:getAuthHeaders(),body:JSON.stringify({nombre,descripcion,categoria,precio})});
        }else{
            if(!sku){showToast('SKU obligatorio para productos nuevos.','error');return;}
            // Crear: recopilar ÚNICAMENTE las sucursales marcadas con stock > 0
            const stockPorSucursal = [];
            (state.sucursales||[]).forEach(s=>{
                const chk = document.getElementById('stock-nuevo-check-'+s.id);
                const disp = parseInt(document.getElementById('stock-nuevo-disp-'+s.id)?.value||'0',10)||0;
                const min = parseInt(document.getElementById('stock-nuevo-min-'+s.id)?.value||'2',10)||2;
                if ((chk && chk.checked) || disp > 0) {
                    stockPorSucursal.push({
                        sucursal_id: s.id,
                        stock_inicial: Math.max(0, disp),
                        stock_minimo: Math.max(0, min)
                    });
                }
            });

            if (!stockPorSucursal.length) {
                showToast('Debes seleccionar al menos una sucursal con stock disponible.', 'error');
                return;
            }

            res=await fetch(API_BASE_URL+'/api/productos',{
                method:'POST',
                headers:getAuthHeaders(),
                body:JSON.stringify({
                    nombre,
                    descripcion,
                    categoria,
                    precio,
                    sku,
                    stock_por_sucursal: stockPorSucursal
                })
            });
        }
        if(!res.ok){const err=await res.json().catch(()=>({detail:'Error'}));throw new Error(err.detail);}
        cerrarModal('modal-producto-form');showToast(id?'Producto actualizado!':'Producto creado!','success');
        cargarInventarioEmpleado();cargarCatalogo();
    }catch(e){showToast(e.message,'error');}
}

async function guardarStockSucursal(inventarioId){
    const disp=parseInt(document.getElementById('stock-edit-disp-'+inventarioId)?.value||'0',10);
    const min=parseInt(document.getElementById('stock-edit-min-'+inventarioId)?.value||'2',10);
    if(isNaN(disp)||disp<0){showToast('El stock disponible no puede ser negativo.','error');return;}
    try{
        const res=await fetch(API_BASE_URL+'/api/inventario/'+inventarioId,{
            method:'PUT',headers:getAuthHeaders(),
            body:JSON.stringify({stock_disponible:disp,stock_minimo:min})
        });
        if(!res.ok){const err=await res.json().catch(()=>({detail:'Error'}));throw new Error(err.detail);}
        showToast('Stock actualizado!','success');
        cargarInventarioEmpleado();cargarCatalogo();
    }catch(e){showToast(e.message,'error');}
}

async function agregarProductoASucursal(){
    const productoId = document.getElementById('prod-form-id').value;
    const sucursalId = document.getElementById('prod-form-nueva-sucursal')?.value;
    const stock = parseInt(document.getElementById('prod-form-nuevo-stock')?.value || '0', 10);
    if (!productoId || !sucursalId) return;
    if (isNaN(stock) || stock <= 0) {
        showToast('Ingresá un stock inicial mayor a 0.', 'error');
        return;
    }
    try {
        const res = await fetch(API_BASE_URL + '/api/inventario', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                producto_id: parseInt(productoId, 10),
                sucursal_id: parseInt(sucursalId, 10),
                stock_disponible: stock,
                stock_minimo: 2
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Error' }));
            throw new Error(err.detail);
        }
        showToast('Producto asignado a la sucursal!', 'success');
        await recargarStockEditar(productoId);
        cargarInventarioEmpleado();
        cargarCatalogo();
    } catch(e) {
        showToast(e.message, 'error');
    }
}

async function quitarProductoSucursal(inventarioId, productoId){
    if (!confirm('¿Seguro que querés quitar este producto de esta sucursal?')) return;
    try {
        const res = await fetch(API_BASE_URL + '/api/inventario/' + inventarioId, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Error' }));
            throw new Error(err.detail);
        }
        showToast('Producto quitado de la sucursal.', 'success');
        await recargarStockEditar(productoId);
        cargarInventarioEmpleado();
        cargarCatalogo();
    } catch(e) {
        showToast(e.message, 'error');
    }
}

async function eliminarProducto(id){
    if(!confirm('Seguro que queres eliminar este producto completamente?'))return;
    try{
        const res=await fetch(API_BASE_URL+'/api/productos/'+id,{method:'DELETE',headers:getAuthHeaders()});
        if(!res.ok)throw new Error('No se pudo eliminar');
        showToast('Producto eliminado.','success');cargarInventarioEmpleado();cargarCatalogo();
    }catch(e){showToast(e.message,'error');}
}

// ==========================================================================
// EMPLEADO: TODAS LAS ORDENES
// ==========================================================================
async function cargarTodasLasOrdenes(){
    const tbody=document.getElementById('tbody-todas-ordenes');
    if(!tbody)return;
    tbody.innerHTML='<tr><td colspan="7" class="text-center text-muted">Cargando...</td></tr>';
    try{
        const res=await fetch(API_BASE_URL+'/api/ordenes',{headers:getAuthHeaders()});
        if(!res.ok)throw new Error('No se pudieron cargar las ordenes');
        state.todasLasOrdenes = await res.json();
        filtrarOrdenes();
    }catch(e){tbody.innerHTML='<tr><td colspan="7" class="text-center text-muted">'+e.message+'</td></tr>';}
}

function filtrarOrdenes(){
    const tbody=document.getElementById('tbody-todas-ordenes');
    if(!tbody)return;
    const ordenes = state.todasLasOrdenes || [];
    const sucVal = document.getElementById('ord-filtro-sucursal')?.value || document.getElementById('sucursal-global')?.value || 'todas';
    const pinVal = (document.getElementById('ord-filtro-pin')?.value || '').trim().toUpperCase();

    const filtradas = ordenes.filter(o => {
        const coincideSucursal = (sucVal === 'todas' || String(o.sucursal_id) === String(sucVal));
        const pinOrden = (o.pin || '').toUpperCase();
        const coincidePin = (!pinVal || pinOrden.includes(pinVal));
        return coincideSucursal && coincidePin;
    });

    if(!filtradas.length){
        tbody.innerHTML='<tr><td colspan="7" class="text-center text-muted">No se encontraron órdenes con los filtros aplicados.</td></tr>';
        return;
    }

    tbody.innerHTML=filtradas.map(o=>{
        const suc=state.sucursales.find(s=>s.id===o.sucursal_id);
        const ec=o.estado==='retirada'?'text-green':o.estado==='cancelada'?'text-red':'';
        const venc=o.fecha_vencimiento?new Date(o.fecha_vencimiento).toLocaleString('es-AR'):'-';
        const puede=o.estado==='reservada'||o.estado==='lista_retiro';
        const btnDetalle = '<button class="btn btn-outline btn-sm" onclick="abrirModalDetalleOrden('+o.id+')" style="margin-right:6px;" title="Ver productos de esta orden">📦 Ver Productos</button>';
        const btnRetiro = puede ? '<button class="btn btn-primary btn-sm" onclick="abrirModalRetiro('+o.id+')">Confirmar Retiro</button>' : '';
        return '<tr><td>ORD-'+o.id+'</td><td>'+(o.usuario_id||'Anonimo')+'</td><td>'+(suc?suc.nombre:'#'+o.sucursal_id)+'</td><td>$'+Number(o.total).toLocaleString('es-AR')+'</td><td class="'+ec+'">'+o.estado.toUpperCase()+'</td><td>'+venc+'</td><td><div style="display:inline-flex;align-items:center;">'+btnDetalle+btnRetiro+'</div></td></tr>';
    }).join('');
}

function abrirModalDetalleOrden(ordenId){
    let orden = (state.todasLasOrdenes || []).find(o => o.id === ordenId);
    if (!orden) {
        fetch(API_BASE_URL+'/api/ordenes/'+ordenId, {headers: getAuthHeaders()})
            .then(r => {
                if(!r.ok) throw new Error('No se pudo cargar el detalle de la orden');
                return r.json();
            })
            .then(o => renderModalDetalleOrden(o))
            .catch(e => showToast(e.message, 'error'));
        return;
    }
    renderModalDetalleOrden(orden);
}

function renderModalDetalleOrden(orden){
    document.getElementById('modal-detalle-orden-titulo').textContent = 'Detalle de la Orden ORD-' + orden.id;
    const suc = state.sucursales.find(s => s.id === orden.sucursal_id);
    document.getElementById('modal-detalle-orden-subtitulo').textContent = 
        (suc ? 'Sucursal: ' + suc.nombre : '') + ' • Estado: ' + (orden.estado || '').toUpperCase();
    
    const tbody = document.getElementById('modal-detalle-orden-tbody');
    const items = orden.items || [];
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Sin detalles de productos registrados.</td></tr>';
    } else {
        tbody.innerHTML = items.map(it => {
            const nombre = it.nombre || ('Producto #' + it.producto_id);
            const cant = it.cantidad || 1;
            const precioU = Number(it.precio_unitario || 0);
            const sub = cant * precioU;
            return `<tr>
                <td style="font-weight:600;">${nombre}</td>
                <td style="text-align:center;">${cant}</td>
                <td style="text-align:right;">$${precioU.toLocaleString('es-AR')}</td>
                <td style="text-align:right;color:var(--cyan);font-weight:600;">$${sub.toLocaleString('es-AR')}</td>
            </tr>`;
        }).join('');
    }
    document.getElementById('modal-detalle-orden-total').textContent = '$' + Number(orden.total || 0).toLocaleString('es-AR');
    document.getElementById('modal-detalle-orden').classList.add('activo');
}

function abrirModalRetiro(ordenId){
    document.getElementById('retiro-orden-id').value=ordenId;
    document.getElementById('retiro-orden-id-label').textContent='ORD-'+ordenId;
    document.getElementById('retiro-pin-input').value='';
    document.getElementById('modal-confirmar-retiro').classList.add('activo');
}
async function confirmarRetiro(){
    const ordenId=document.getElementById('retiro-orden-id').value;
    const pin=document.getElementById('retiro-pin-input').value.trim();
    if(!pin){showToast('Ingresa el PIN del cliente','error');return;}
    try{
        const res=await fetch(API_BASE_URL+'/api/ordenes/'+ordenId+'/retirar',{
            method:'POST',headers:getAuthHeaders(),body:JSON.stringify({pin})
        });
        if(!res.ok){const err=await res.json().catch(()=>({detail:'Error'}));throw new Error(err.detail||'PIN incorrecto');}
        cerrarModal('modal-confirmar-retiro');showToast('Retiro confirmado! Stock descontado.','success');
        cargarTodasLasOrdenes();cargarCatalogo();
    }catch(e){showToast(e.message,'error');}
}

// ==========================================================================
// CSS EXTRA (tablas y auth)
// ==========================================================================
const extraCSS=document.createElement('style');
extraCSS.textContent='.tabla-inventario{width:100%;border-collapse:collapse;font-size:.9rem;}.tabla-inventario th,.tabla-inventario td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border,#2d3748);}.tabla-inventario thead{background:var(--surface-2,#1a202c);}.tabla-inventario tbody tr:hover{background:rgba(0,204,255,.04);}.btn-sm{padding:5px 10px;font-size:.8rem;}.text-red{color:#fc5c5c;}.text-green{color:var(--green,#48bb78);}.mb-20{margin-bottom:20px;}.mt-10{margin-top:10px;}.auth-container{display:flex;align-items:center;gap:10px;margin-left:auto;}.auth-label{font-size:.85rem;color:var(--cyan);font-weight:600;}.auth-tabs{display:flex;gap:4px;flex:1;}.auth-tab{background:transparent;border:none;padding:10px 18px;cursor:pointer;color:var(--text-muted,#a0aec0);font-weight:600;border-bottom:2px solid transparent;transition:all .2s;}.auth-tab.active{color:var(--cyan,#00ccff);border-bottom-color:var(--cyan,#00ccff);}.rol-selector{display:flex;gap:12px;}.rol-option{display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px 16px;border:1px solid var(--border,#2d3748);border-radius:8px;flex:1;justify-content:center;transition:.2s;}.rol-option:has(input:checked){border-color:var(--cyan,#00ccff);background:rgba(0,204,255,.08);}.rol-label{font-weight:600;}';
document.head.appendChild(extraCSS);

// ==========================================================================
// INICIALIZACION
// ==========================================================================
window.addEventListener('DOMContentLoaded',()=>{
    cargarSesionGuardada();
    aplicarVisibilidad();
    cargarCatalogo();
});
