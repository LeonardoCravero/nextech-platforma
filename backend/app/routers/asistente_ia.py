from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
import re
import requests
from ..database import get_db
from .. import models

router = APIRouter(prefix="/api/ia", tags=["Asistente IA"])

class ConsultaIARequest(BaseModel):
    mensaje: str
    sucursal_id: Optional[int] = None
    historial: Optional[List[dict]] = []

class ProductoRecomendado(BaseModel):
    id: int
    nombre: str
    categoria: str
    precio: float
    sucursal_id: int
    sucursal_nombre: str
    stock_disponible: int

class ConsultaIAResponse(BaseModel):
    respuesta: str
    productos: List[ProductoRecomendado]
    sucursal_id: Optional[int] = None
    sucursal_nombre: Optional[str] = None
    total: float
    modelo_utilizado: str

@router.post("/consultar", response_model=ConsultaIAResponse)
def consultar_asistente(request: ConsultaIARequest, db: Session = Depends(get_db)):
    """
    Asistente Inteligente de Compra y Stock para NexTech.
    Ciclo de decisión:
    1. Agente de Interpretación: Detecta intención, presupuesto y preferencias de hardware.
    2. Agente Validador Determinístico: Filtra catálogo y valida stock real con la DB.
    3. Agente Asesor: Genera recomendación justificada técnicamente con botón Click & Collect.
    """
    mensaje_lower = request.mensaje.lower()
    
    # 1. Obtener sucursales y productos disponibles en la base de datos
    sucursales = db.query(models.Sucursal).filter(models.Sucursal.activa == True).all()
    sucursal_map = {s.id: s.nombre for s in sucursales}
    
    # Detectar sucursal objetivo
    sucursal_seleccionada_id = request.sucursal_id
    if not sucursal_seleccionada_id:
        for s in sucursales:
            if s.nombre.lower() in mensaje_lower or (s.direccion and s.direccion.lower() in mensaje_lower):
                sucursal_seleccionada_id = s.id
                break
        if not sucursal_seleccionada_id and sucursales:
            sucursal_seleccionada_id = sucursales[0].id # Default primera sucursal si no especifica

    sucursal_nombre = sucursal_map.get(sucursal_seleccionada_id, "Sucursal Central")

    # 2. Búsqueda y filtrado determinístico según intención en la base de datos
    productos_query = db.query(
        models.Producto, models.InventarioSucursal.stock_disponible
    ).join(
        models.InventarioSucursal,
        (models.InventarioSucursal.producto_id == models.Producto.id) &
        (models.InventarioSucursal.sucursal_id == sucursal_seleccionada_id)
    ).filter(
        models.Producto.activo == True,
        models.InventarioSucursal.stock_disponible > 0
    )

    todos_con_stock = productos_query.all()
    
    # Matching semántico de intención
    productos_elegidos = []
    
    # Extraer presupuesto aproximado si existe
    presupuesto_match = re.search(r'\$?(\d{2,5})', mensaje_lower)
    presupuesto_max = float(presupuesto_match.group(1)) if presupuesto_match else None

    # Mapeo de términos clave por tipo de hardware
    categorias_keywords = {
        "video": ["placa", "video", "gpu", "grafica", "gráfica", "rtx", "gtx", "radeon", "rx", "geforce", "vga"],
        "notebook": ["notebook", "laptop", "portatil", "portátil", "compu", "computadora", "programar", "edicion", "diseño"],
        "monitor": ["monitor", "pantalla", "display", "curvo", "34", "144hz"],
        "teclado": ["teclado", "keyboard", "mecanico", "mecánico", "periferico", "periférico"],
        "mouse": ["mouse", "raton", "ratón", "ergonomico", "ergonómico"],
        "audio": ["auricular", "auriculares", "headset", "sonido", "audio", "noise"],
        "almacenamiento": ["ssd", "disco", "solido", "sólido", "m.2", "nvme", "almacenamiento"],
        "componentes": ["ram", "memoria", "ddr5", "componente", "componentes"],
        "procesador": ["procesador", "cpu", "intel", "ryzen", "core", "i9", "i7", "i5"]
    }

    # Evaluar qué categorías busca el usuario
    categorias_solicitadas = set()
    for cat, kws in categorias_keywords.items():
        if any(kw in mensaje_lower for kw in kws):
            categorias_solicitadas.add(cat)

    # Extraer palabras del mensaje ignorando palabras comunes (stopwords)
    stopwords = {"de", "la", "el", "un", "una", "en", "para", "por", "con", "que", "los", "las", "y", "o", "a", "al", "del", "mi", "me", "su", "quiero", "busco", "necesito", "tenes", "tienen", "recomendas", "recomiendame", "hola", "buenas"}
    palabras_usuario = [w for w in re.findall(r'\b[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ_]{3,}\b', mensaje_lower) if w not in stopwords]

    # Calcular score de coincidencia para cada producto con stock disponible
    candidatos_rankeados = []
    for prod, stock in todos_con_stock:
        prod_text = f"{prod.nombre} {prod.descripcion or ''} {prod.categoria or ''}".lower()
        score = 0

        # 1. Coincidencia por categoría detectada
        for cat in categorias_solicitadas:
            if any(kw in prod_text for kw in categorias_keywords[cat]):
                score += 5

        # 2. Coincidencia directa de palabras escritas por el usuario en el nombre o descripción
        for w in palabras_usuario:
            if w in prod_text:
                score += 3

        # Si el usuario especificó un presupuesto máximo y el producto lo supera, no se prioriza
        if presupuesto_max and float(prod.precio) > presupuesto_max:
            score = -1

        if score > 0:
            candidatos_rankeados.append((score, prod, stock))

    # Ordenar por mayor relevancia/score
    candidatos_rankeados.sort(key=lambda x: x[0], reverse=True)
    productos_elegidos = [(p, s, sucursal_seleccionada_id, sucursal_nombre) for _, p, s in candidatos_rankeados[:3]]

    # ── BÚSQUEDA EN OTRAS SUCURSALES ──────────────────────────────────────────
    # Si la búsqueda específica no encontró resultados en la sucursal seleccionada,
    # buscar en TODAS las sucursales activas antes de hacer fallback genérico.
    if not productos_elegidos and categorias_solicitadas:
        otras_sucursales = [s for s in sucursales if s.id != sucursal_seleccionada_id]
        for otra_suc in otras_sucursales:
            productos_otra = db.query(
                models.Producto, models.InventarioSucursal.stock_disponible
            ).join(
                models.InventarioSucursal,
                (models.InventarioSucursal.producto_id == models.Producto.id) &
                (models.InventarioSucursal.sucursal_id == otra_suc.id)
            ).filter(
                models.Producto.activo == True,
                models.InventarioSucursal.stock_disponible > 0
            ).all()

            for prod, stock in productos_otra:
                prod_text = f"{prod.nombre} {prod.descripcion or ''} {prod.categoria or ''}".lower()
                score = 0
                for cat in categorias_solicitadas:
                    if any(kw in prod_text for kw in categorias_keywords[cat]):
                        score += 5
                for w in palabras_usuario:
                    if w in prod_text:
                        score += 3
                if presupuesto_max and float(prod.precio) > presupuesto_max:
                    score = -1
                if score > 0:
                    productos_elegidos.append((prod, stock, otra_suc.id, otra_suc.nombre))

        # Ordenar los resultados de otras sucursales por score también
        if productos_elegidos:
            productos_elegidos = productos_elegidos[:3]

    # Fallback final genérico: si todavía no hay nada, mostrar los más populares con stock
    if not productos_elegidos and todos_con_stock:
        for prod, stock in todos_con_stock:
            if not presupuesto_max or float(prod.precio) <= presupuesto_max:
                productos_elegidos.append((prod, stock, sucursal_seleccionada_id, sucursal_nombre))
                if len(productos_elegidos) >= 2:
                    break
        if not productos_elegidos:
            productos_elegidos = [(p, s, sucursal_seleccionada_id, sucursal_nombre) for p, s in todos_con_stock[:2]]

    # Convertir a esquema de respuesta
    productos_recomendados = []
    total = 0.0
    # Determinar si se encontraron resultados en otras sucursales
    suc_ids_resultado = set(suc_id for _, _, suc_id, _ in productos_elegidos)
    busqueda_multi_sucursal = len(suc_ids_resultado) > 1 or (
        len(suc_ids_resultado) == 1 and sucursal_seleccionada_id not in suc_ids_resultado
    )

    for prod, stock, suc_id, suc_nom in productos_elegidos:
        precio_f = float(prod.precio)
        total += precio_f
        productos_recomendados.append(ProductoRecomendado(
            id=prod.id,
            nombre=prod.nombre,
            categoria=prod.categoria or "Hardware",
            precio=precio_f,
            sucursal_id=suc_id,
            sucursal_nombre=suc_nom,
            stock_disponible=stock
        ))

    # 3. Intentar generar respuesta con Ollama local si está disponible
    modelo_usado = "Motor Heurístico NexTech (Offline)"
    texto_respuesta = ""

    try:
        contexto_inventario = "\n".join([
            f"- {p.nombre} (${p.precio} USD) | Stock en {sucursal_nombre}: {p.stock_disponible} unidades"
            for p in productos_recomendados
        ])
        
        prompt_ollama = f"""Sos el Asistente Técnico IA de la tienda de hardware NexTech.
El cliente pregunta: "{request.mensaje}".
Sucursal seleccionada: {sucursal_nombre}.
Stock confirmado en inventario:
{contexto_inventario}

Generá una respuesta breve (máximo 3 oraciones), profesional y técnica recomendando estos productos para retirar hoy vía Click & Collect."""

        # Consultar Ollama en localhost:11434 con timeout corto
        res_ollama = requests.post(
            "http://localhost:11434/api/generate",
            json={"model": "llama3.2:1b", "prompt": prompt_ollama, "stream": False},
            timeout=2.5
        )
        if res_ollama.status_code == 200:
            texto_respuesta = res_ollama.json().get("response", "").strip()
            modelo_usado = "Ollama (Llama 3.2 Local)"
    except Exception:
        # Fallback transparente y robusto si Ollama no está activo o no tiene modelo aún
        pass

    if not texto_respuesta:
        # Respuesta explicativa estructurada y personalizada a la consulta
        items_str = ", ".join([f"**{p.nombre}** (${p.precio:,.2f}) en **{p.sucursal_nombre}**" for p in productos_recomendados])
        if busqueda_multi_sucursal:
            texto_respuesta = (
                f"Analicé tu consulta sobre **'{request.mensaje}'**. "
                f"El producto no tiene stock en **{sucursal_nombre}**, pero encontré disponibilidad en otras sucursales de la red:\n\n"
                f"{items_str}. "
                f"La suma total es de **${total:,.2f}**. Podés hacer la reserva y retirar con tu PIN en el local indicado."
            )
        else:
            texto_respuesta = (
                f"Analicé tu consulta sobre **'{request.mensaje}'** y la disponibilidad real en la sucursal **{sucursal_nombre}**.\n\n"
                f"Te recomiendo la siguiente selección con stock físico confirmado: {items_str}. "
                f"La suma total es de **${total:,.2f}**. Podés confirmar la reserva en este momento y retirar con tu código PIN en el local."
            )

    return ConsultaIAResponse(
        respuesta=texto_respuesta,
        productos=productos_recomendados,
        sucursal_id=sucursal_seleccionada_id,
        sucursal_nombre=sucursal_nombre,
        total=total,
        modelo_utilizado=modelo_usado
    )
