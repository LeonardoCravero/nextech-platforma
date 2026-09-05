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
        "notebook": ["notebook", "laptop", "portatil", "compu", "computadora", "programar", "edicion", "diseño"],
        "monitor": ["monitor", "pantalla", "display", "curvo", "34"],
        "teclado": ["teclado", "keyboard", "mecanico", "periferico"],
        "mouse": ["mouse", "raton", "ergonomico"],
        "audio": ["auricular", "auriculares", "headset", "sonido", "audio", "noise"],
        "almacenamiento": ["ssd", "disco", "solido", "m.2", "nvme", "almacenamiento"],
        "componentes": ["ram", "memoria", "ddr5"]
    }

    # Evaluar qué categorías busca el usuario
    categorias_solicitadas = set()
    for cat, kws in categorias_keywords.items():
        if any(kw in mensaje_lower for kw in kws):
            categorias_solicitadas.add(cat)

    if not categorias_solicitadas:
        # Si la consulta es general (ej: "qué me recomendás con $1000?"), seleccionar lo más destacado
        for prod, stock in todos_con_stock:
            if not presupuesto_max or float(prod.precio) <= presupuesto_max:
                productos_elegidos.append((prod, stock))
                if len(productos_elegidos) >= 2:
                    break
    else:
        for prod, stock in todos_con_stock:
            prod_text = f"{prod.nombre} {prod.descripcion} {prod.categoria}".lower()
            if any(any(kw in prod_text for kw in categorias_keywords[cat]) for cat in categorias_solicitadas):
                productos_elegidos.append((prod, stock))

    # Si aún no encontró productos específicos, tomar los 2 más relevantes con stock
    if not productos_elegidos and todos_con_stock:
        productos_elegidos = todos_con_stock[:2]

    # Convertir a esquema de respuesta
    productos_recomendados = []
    total = 0.0
    for prod, stock in productos_elegidos:
        precio_f = float(prod.precio)
        total += precio_f
        productos_recomendados.append(ProductoRecomendado(
            id=prod.id,
            nombre=prod.nombre,
            categoria=prod.categoria or "Hardware",
            precio=precio_f,
            sucursal_id=sucursal_seleccionada_id,
            sucursal_nombre=sucursal_nombre,
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
        # Respuesta explicativa estructurada
        items_str = ", ".join([f"**{p.nombre}** (${p.precio:,.2f})" for p in productos_recomendados])
        texto_respuesta = (
            f"Analicé tu consulta y la disponibilidad real en la sucursal **{sucursal_nombre}**.\n\n"
            f"Te recomiendo la siguiente selección de equipamiento con stock físico confirmado: {items_str}. "
            f"La suma total es de **${total:,.2f}**. Podés confirmar la reserva en este momento y retirar con tu código PIN en menos de 1 hora."
        )

    return ConsultaIAResponse(
        respuesta=texto_respuesta,
        productos=productos_recomendados,
        sucursal_id=sucursal_seleccionada_id,
        sucursal_nombre=sucursal_nombre,
        total=total,
        modelo_utilizado=modelo_usado
    )
