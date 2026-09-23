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

    # 2. Búsqueda y disponibilidad en TODA la red de sucursales con stock > 0
    inventario_general = db.query(
        models.Producto,
        models.InventarioSucursal.stock_disponible,
        models.Sucursal.id.label("sucursal_id"),
        models.Sucursal.nombre.label("sucursal_nombre")
    ).join(
        models.InventarioSucursal,
        models.InventarioSucursal.producto_id == models.Producto.id
    ).join(
        models.Sucursal,
        models.Sucursal.id == models.InventarioSucursal.sucursal_id
    ).filter(
        models.Producto.activo == True,
        models.Sucursal.activa == True,
        models.InventarioSucursal.stock_disponible > 0
    ).all()

    # Agrupar existencias por producto único prefiriendo la sucursal seleccionada si hay stock ahí
    productos_map = {}
    for prod, stock, suc_id, suc_nom in inventario_general:
        pid = prod.id
        if pid not in productos_map:
            productos_map[pid] = {
                "producto": prod,
                "stock": stock,
                "sucursal_id": suc_id,
                "sucursal_nombre": suc_nom,
                "es_sucursal_elegida": (suc_id == sucursal_seleccionada_id)
            }
        else:
            if suc_id == sucursal_seleccionada_id and not productos_map[pid]["es_sucursal_elegida"]:
                productos_map[pid] = {
                    "producto": prod,
                    "stock": stock,
                    "sucursal_id": suc_id,
                    "sucursal_nombre": suc_nom,
                    "es_sucursal_elegida": True
                }
            elif not productos_map[pid]["es_sucursal_elegida"] and stock > productos_map[pid]["stock"]:
                productos_map[pid] = {
                    "producto": prod,
                    "stock": stock,
                    "sucursal_id": suc_id,
                    "sucursal_nombre": suc_nom,
                    "es_sucursal_elegida": False
                }

    # Extraer presupuesto aproximado si existe en el texto (ej: $1000)
    presupuesto_match = re.search(r'\$?(\d{2,5})', mensaje_lower)
    presupuesto_max = float(presupuesto_match.group(1)) if presupuesto_match else None

    # Detectar si el cliente busca la opción más barata / económica
    keywords_economico = [
        "barato", "barata", "baratos", "baratas", 
        "economico", "economica", "economicos", "economicas",
        "económico", "económica", "económicos", "económicas",
        "accesible", "accesibles", "menor precio", "precio bajo",
        "mas bajo", "más bajo", "bajo costo", "mas economica", "más económica",
        "mas barato", "más barato", "lo mas barato", "lo más barato",
        "la mas barata", "la más barata", "la mas economica", "la más económica"
    ]
    busca_economico = any(kw in mensaje_lower for kw in keywords_economico)

    # Mapeo de términos clave por tipo de hardware
    categorias_keywords = {
        "video": ["placa de video", "placas de video", "placa", "video", "gpu", "grafica", "gráfica", "rtx", "gtx", "radeon", "rx", "geforce", "vga"],
        "notebook": ["notebook", "notebooks", "laptop", "laptops", "portatil", "portátil", "compu", "computadora", "computadoras", "pc", "ordenador"],
        "monitor": ["monitor", "monitores", "pantalla", "pantallas", "display", "curvo", "34", "144hz", "ultrawide"],
        "teclado": ["teclado", "teclados", "keyboard", "mecanico", "mecánico", "periferico", "periférico"],
        "mouse": ["mouse", "raton", "ratón", "ergonomico", "ergonómico"],
        "audio": ["auricular", "auriculares", "headset", "sonido", "audio", "noise", "microfono", "parlante"],
        "almacenamiento": ["ssd", "disco", "discos", "solido", "sólido", "m.2", "nvme", "almacenamiento"],
        "componentes": ["ram", "memoria", "memorias", "ddr5", "componente", "componentes"],
        "procesador": ["procesador", "procesadores", "cpu", "intel", "ryzen", "core", "i9", "i7", "i5"]
    }

    # Evaluar qué categorías busca el usuario con límites de palabra para evitar falsos positivos
    categorias_solicitadas = set()
    for cat, kws in categorias_keywords.items():
        for kw in kws:
            pattern = r'\b' + re.escape(kw) + r'\b'
            if re.search(pattern, mensaje_lower):
                categorias_solicitadas.add(cat)
                break

    # Stopwords ampliadas (incluye palabras de precio y modificadores para no buscarlas como hardware)
    stopwords = {
        "de", "la", "el", "un", "una", "en", "para", "por", "con", "que", "los", "las", "y", "o", "a", "al", "del",
        "mi", "me", "su", "quiero", "busco", "necesito", "tenes", "tienen", "recomendas", "recomiendame", "hola", "buenas",
        "mas", "más", "menos", "tan", "muy", "barato", "barata", "baratos", "baratas", "economico", "economica", "economicos",
        "accesible", "cual", "cuál", "algun", "alguno", "alguna", "como", "esta", "este"
    }
    palabras_usuario = [w for w in re.findall(r'\b[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ_]{3,}\b', mensaje_lower) if w not in stopwords]

    # Calcular coincidencia para cada producto disponible en la red
    candidatos = []
    for item in productos_map.values():
        prod = item["producto"]
        stock = item["stock"]
        suc_id = item["sucursal_id"]
        suc_nom = item["sucursal_nombre"]
        es_elegida = item["es_sucursal_elegida"]

        prod_text = f"{prod.nombre} {prod.descripcion or ''} {prod.categoria or ''}".lower()
        palabras_prod = set(re.findall(r'\b[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ_]{2,}\b', prod_text))
        score = 0
        coincide_categoria = False

        # 1. Coincidencia por categoría detectada
        if categorias_solicitadas:
            for cat in categorias_solicitadas:
                for kw in categorias_keywords[cat]:
                    if " " in kw:
                        if kw in prod_text:
                            score += 15
                            coincide_categoria = True
                            break
                    else:
                        if kw in palabras_prod:
                            score += 10
                            coincide_categoria = True
                            break
            # Si el cliente pidió una categoría específica (ej: computadora o placa de video), solo clasifican los que pertenezcan a ella
            if not coincide_categoria:
                continue

        # 2. Coincidencia por palabras directas del usuario
        for w in palabras_usuario:
            if w in palabras_prod:
                score += 5

        # 3. Bonus si está en la sucursal seleccionada
        if es_elegida:
            score += 1

        # Filtro de presupuesto tope numérico (ej: $1000)
        if presupuesto_max and float(prod.precio) > presupuesto_max:
            score = -1

        if score > 0:
            candidatos.append((score, float(prod.precio), prod, stock, suc_id, suc_nom))

    # Ordenamiento inteligente
    if candidatos:
        if busca_economico:
            # Si busca lo más económico, ordenar por precio menor primero
            candidatos.sort(key=lambda x: (x[1], -x[0]))
        else:
            # Si no, ordenar por mayor relevancia/score y luego por precio
            candidatos.sort(key=lambda x: (-x[0], x[1]))
        productos_elegidos = [(p, s, sid, snom) for _, _, p, s, sid, snom in candidatos[:2 if busca_economico else 3]]
    else:
        # Fallback si no hubo coincidencia específica: tomar lo más accesible o destacado de todo el inventario
        items_todos = list(productos_map.values())
        if busca_economico:
            items_todos.sort(key=lambda x: float(x["producto"].precio))
        else:
            items_todos.sort(key=lambda x: -x["stock"])

        productos_elegidos = []
        for it in items_todos:
            prod = it["producto"]
            if not presupuesto_max or float(prod.precio) <= presupuesto_max:
                productos_elegidos.append((prod, it["stock"], it["sucursal_id"], it["sucursal_nombre"]))
                if len(productos_elegidos) >= (2 if busca_economico else 3):
                    break

    # Convertir a esquema de respuesta
    productos_recomendados = []
    total = 0.0
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
            f"- {p.nombre} (${p.precio:,.2f} USD) | Disponible en {p.sucursal_nombre} ({p.stock_disponible} unidades)"
            for p in productos_recomendados
        ])
        
        prompt_ollama = f"""Sos el Asistente Técnico IA de la tienda de hardware NexTech.
El cliente pregunta: "{request.mensaje}".
Productos recomendados disponibles:
{contexto_inventario}

Respondé comenzando exactamente con:
"He analizado tu consulta.
Acá tenés mi recomendación:"
Y explicá brevemente y de forma profesional por qué recomendás estos productos (máximo 3 oraciones)."""

        res_ollama = requests.post(
            "http://localhost:11434/api/generate",
            json={"model": "llama3.2:1b", "prompt": prompt_ollama, "stream": False},
            timeout=2.5
        )
        if res_ollama.status_code == 200:
            texto_respuesta = res_ollama.json().get("response", "").strip()
            modelo_usado = "Ollama (Llama 3.2 Local)"
    except Exception:
        pass

    if not texto_respuesta:
        # Formato de respuesta conversacional y estructurado solicitado
        items_bullets = "\n".join([
            f"• **{p.nombre}** (${p.precio:,.2f} USD) — Disponible en **{p.sucursal_nombre}** ({p.stock_disponible} unid.)"
            for p in productos_recomendados
        ])

        if busca_economico:
            texto_respuesta = (
                f"He analizado tu consulta.\n\n"
                f"Acá tenés mi recomendación con la opción más económica disponible:\n\n"
                f"{items_bullets}\n\n"
                f"Es la mejor alternativa en relación costo-rendimiento con stock físico confirmado. Podés iniciar tu reserva a continuación para asegurar tu unidad y retirarla con tu PIN."
            )
        else:
            texto_respuesta = (
                f"He analizado tu consulta.\n\n"
                f"Acá tenés mi recomendación:\n\n"
                f"{items_bullets}\n\n"
                f"Todos los productos cuentan con disponibilidad física confirmada. Podés iniciar tu reserva Click & Collect directamente en los botones a continuación."
            )

    return ConsultaIAResponse(
        respuesta=texto_respuesta,
        productos=productos_recomendados,
        sucursal_id=sucursal_seleccionada_id,
        sucursal_nombre=sucursal_nombre,
        total=total,
        modelo_utilizado=modelo_usado
    )
