#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf_a_preguntas.py
Convierte PDFs de exámenes MINEDU a JSON estructurado para el simulador.
Soporta español/inglés, alternativas A-E (incluso en la misma línea),
contextos compartidos y extracción de claves de respuestas.
"""

import sys
import os
import re
import json
import argparse
from typing import Dict, List, Optional, Tuple, Any

# Importación de librerías PDF (prioriza pymupdf moderno para evitar advertencias)
try:
    import pymupdf as fitz
except ImportError:
    try:
        import fitz
    except ImportError:
        fitz = None

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    import pypdfium2 as pdfium
except ImportError:
    pdfium = None

# Opciones válidas y separadores admitidos tras la letra
LETRAS = "ABCDE"
CIERRE = r"[\)\]\}\.\-\u2013:]"

# Patrones para preguntas (Español / Inglés)
RE_PREG_PALABRA = re.compile(
    r"^(?:pregunta|problema|[i\u00ed]tem|question)\s*(?:n[\u00b0\u00ba\.]?\s*)?[\(\[\{]?(\d{1,3})[\)\]\}]?\s*[\.\:\-\u2013]*\s*(.*)$",
    re.I
)
RE_PREG_NUM = re.compile(r"^[\(\[\{]?(\d{1,3})[\)\]\}\.\-\u2013:\u00b0\u00ba]+(?:\s+(.*))?$")
RE_ORDINAL = re.compile(r"^\d+[\.\)]?\s*[\xba\xb0°º]?\s*(?:de\s+secundaria|de\s+primaria|grado|año|ano|básico)", re.I)

# Patrones para alternativas (Option A, Alternativa A, A), etc.)
RE_ALT_PALABRA = re.compile(
    r"^(?:alternativa|alt\.?|opci[o\u00f3]n|option|opt\.?|rpta\.?)\s*[\(\[\{]?([A-Ea-e])[\)\]\}\.\-\u2013:]*(?:\s+(.*))?$",
    re.I
)
RE_ALT_MARCA = re.compile(r"^[\(\[\{]?([A-Ea-e])" + CIERRE + r"+(?:\s+(.*))?$")

# Contextos compartidos ("Lea la siguiente situación...", "Read the following...")
RE_CTX_ES = re.compile(
    r"^(?:lea\s+(?:la\s+siguiente\s+situaci[o\u00f3]n|el\s+siguiente\s+texto)|a\s+continuaci[o\u00f3]n.*?)\s+y\s+responda\s+las\s+preguntas\s+(\d+)\s*(?:y|al?)\s*(\d+)",
    re.I
)
RE_CTX_EN = re.compile(
    r"^(?:read\s+(?:the\s+following\s+situation|the\s+following\s+text)).*?\s+answer\s+questions?\s+([\d,\s]+(?:\s+and\s+\d+)?)",
    re.I
)

# Pies de página, notas y metadatos descartables
RE_PIE = re.compile(
    r"(^\d+\s*\|?\s*A\d+-[A-Z]+-\d+.*$)|(^A\d+-[A-Z]+-\d+\s*/.*$)|(^Nota\.)|(^P[a\u00e1]gina\s+\d+)|(^Adapted from)|(^Retrieved\s+[A-Za-z0-9]+)",
    re.I
)


def _partir_en_linea(letra: str, resto: str) -> List[Tuple[str, str]]:
    """Separa múltiples alternativas si vienen en una sola línea (ej. 'A) 10  B) 20  C) 30')."""
    letra = letra.upper()
    if letra not in LETRAS:
        return [(letra, resto.strip())]
    
    partes: List[Tuple[str, str]] = []
    idx = LETRAS.index(letra)
    while idx + 1 < len(LETRAS):
        sig = LETRAS[idx + 1]
        m = re.search(r"\s[\(\[\{]?[" + sig + sig.lower() + r"]" + CIERRE + r"+\s+", resto)
        if not m:
            break
        partes.append((LETRAS[idx], resto[:m.start()].strip()))
        resto, idx = resto[m.end():], idx + 1
    partes.append((LETRAS[idx], resto.strip()))
    return partes


def extraer_texto_paginas(ruta_pdf: str) -> List[str]:
    """Extrae texto página por página ordenando visualmente dos columnas (left-to-right, top-to-bottom)."""
    paginas: List[str] = []

    # Intento principal con PyMuPDF: detecta columnas por posición X y filtra encabezados/pies
    if fitz is not None:
        try:
            with fitz.open(ruta_pdf) as doc:
                for page in doc:
                    blocks = page.get_text("blocks")
                    mid_x = page.rect.width / 2
                    # Filtra encabezados (<35) y pies (>805)
                    content = [b for b in blocks if not (b[1] > 805 or (b[1] < 35 and len(b[4].strip()) < 10))]
                    has_l = any(b[2] <= mid_x + 20 and 120 < b[1] < 750 for b in content if len(b[4].strip()) > 30)
                    has_r = any(b[0] >= mid_x - 20 and 120 < b[1] < 750 for b in content if len(b[4].strip()) > 30)

                    if has_l and has_r:
                        ordered = sorted([b for b in content if b[0] < mid_x], key=lambda b: b[1]) + \
                                  sorted([b for b in content if b[0] >= mid_x], key=lambda b: b[1])
                    else:
                        ordered = sorted(content, key=lambda b: b[1])

                    paginas.append("\n".join(b[4] for b in ordered))

            if len("".join(paginas).strip()) >= 50:
                return paginas
        except Exception:
            paginas.clear()

    # Fallback con pdfplumber si PyMuPDF falla o no está instalado
    if pdfplumber is not None:
        with pdfplumber.open(ruta_pdf) as pdf:
            paginas = [p.extract_text() or "" for p in pdf.pages]

    if len("".join(paginas).strip()) < 50:
        raise ValueError("El archivo PDF parece ser escaneado o no contiene texto digital legible.")
    return paginas


def agrupar_preguntas(paginas: List[str], anio: int, curso: str) -> List[Dict[str, Any]]:
    """Parsea el texto agrupando enunciados, alternativas A-E y contextos asociados."""
    preguntas: List[Dict[str, Any]] = []
    actual: Optional[Dict[str, Any]] = None
    destino: Optional[Tuple[str, Optional[str]]] = None  # ("ctx", None) | ("enun", None) | ("alt", letra)
    contextos: Dict[int, str] = {}
    ctx_buf: Optional[List[str]] = None
    ctx_para: Optional[List[int]] = None

    def _flush_ctx():
        """Guarda el texto del contexto acumulado en las preguntas que abarca."""
        nonlocal ctx_buf, ctx_para
        if ctx_buf is not None and ctx_para:
            txt = " ".join(ctx_buf).strip()
            for n in ctx_para:
                contextos[n] = txt
        ctx_buf, ctx_para = None, None

    for pagina in paginas:
        for linea in (l.strip() for l in pagina.splitlines() if l.strip()):
            if RE_PIE.search(linea):
                continue

            # 1. Contexto compartido (Español: "preguntas X al Y" o Inglés: "questions X, Y and Z")
            m_ctx = RE_CTX_ES.search(linea)
            if m_ctx:
                _flush_ctx()
                a, b = int(m_ctx.group(1)), int(m_ctx.group(2))
                ctx_para, ctx_buf, destino = list(range(min(a, b), max(a, b) + 1)), [], ("ctx", None)
                continue

            m_ctx_en = RE_CTX_EN.search(linea)
            if m_ctx_en:
                nums = [int(n) for n in re.findall(r"\b\d+\b", m_ctx_en.group(1))]
                if nums:
                    _flush_ctx()
                    ctx_para, ctx_buf, destino = list(range(min(nums), max(nums) + 1)), [], ("ctx", None)
                    continue

            # 2. Alternativas (A, B, C, D, E)
            m_alt = RE_ALT_PALABRA.match(linea) or RE_ALT_MARCA.match(linea)
            if m_alt and actual and len(actual["alternativas"]) < len(LETRAS):
                letra = m_alt.group(1).upper()
                if letra == LETRAS[len(actual["alternativas"])]:
                    for l, t in _partir_en_linea(letra, (m_alt.group(2) or "").strip()):
                        actual["alternativas"][l] = t
                        destino = ("alt", l)
                    continue

            # 3. Ignorar ordinales de grado escolar en enunciados (ej. "2.° de secundaria")
            if RE_ORDINAL.match(linea):
                if destino and destino[0] == "enun" and actual:
                    actual["enunciado"] = (actual["enunciado"] + " " + linea).strip()
                continue

            # 4. Nueva pregunta (por palabra "Pregunta X" o número correlativo)
            numero, resto = None, ""
            m_pal = RE_PREG_PALABRA.match(linea)
            if m_pal:
                numero, resto = int(m_pal.group(1)), m_pal.group(2) or ""
            else:
                m_num = RE_PREG_NUM.match(linea)
                ultimo = preguntas[-1]["numero"] if preguntas else 0
                anterior_ok = (not preguntas) or len(preguntas[-1]["alternativas"]) >= 2
                if m_num and int(m_num.group(1)) == ultimo + 1 and anterior_ok:
                    numero, resto = int(m_num.group(1)), m_num.group(2) or ""

            if numero is not None:
                _flush_ctx()
                actual = {
                    "anio": anio,
                    "curso": curso,
                    "numero": numero,
                    "enunciado": resto.strip(),
                    "alternativas": {},
                    "correcta": ""
                }
                preguntas.append(actual)
                destino = ("enun", None)
                continue

            # 5. Acumulación multilínea según el estado activo
            if destino:
                if destino[0] == "ctx" and ctx_buf is not None:
                    ctx_buf.append(linea)
                elif destino[0] == "alt" and actual and destino[1]:
                    actual["alternativas"][destino[1]] = (actual["alternativas"][destino[1]] + " " + linea).strip()
                elif destino[0] == "enun" and actual:
                    actual["enunciado"] = (actual["enunciado"] + " " + linea).strip()

    _flush_ctx()

    # Asignar contextos y conservar la versión más completa en caso de duplicados
    for q in preguntas:
        if q["numero"] in contextos:
            q["contexto"] = contextos[q["numero"]]

    p_dict: Dict[int, Dict[str, Any]] = {}
    for q in preguntas:
        num = q["numero"]
        if num not in p_dict or len(q["alternativas"]) > len(p_dict[num]["alternativas"]):
            p_dict[num] = q

    return sorted([q for q in p_dict.values() if len(q["alternativas"]) >= 2], key=lambda q: q["numero"])


# ---------------------------------------------------------------------------
# Figuras: los gráficos de los cuadernillos son dibujos vectoriales (no imágenes
# incrustadas), así que se recortan renderizando la región de la página.
# ---------------------------------------------------------------------------
RE_ETIQUETA_PREG = re.compile(r"^(?:pregunta|question)\s+(\d{1,3})\s*$", re.I)
RE_ETIQUETA_ALT = re.compile(r"^(?:alternativa|option)\s+[A-E](?:\s|$)", re.I)
MAX_FIGURAS_POR_PREGUNTA = 6


def _rect_en(r, contenedor, margen: float = 4.0) -> bool:
    return (r.x0 >= contenedor.x0 - margen and r.x1 <= contenedor.x1 + margen
            and r.y0 >= contenedor.y0 - margen and r.y1 <= contenedor.y1 + margen)


def _agrupar_rects(rects: List[Any], hueco: float = 12.0) -> List[Any]:
    """Une rectángulos cercanos (unión-búsqueda) y devuelve el rectángulo que cubre cada grupo."""
    grupos = [fitz.Rect(r) for r in rects]
    cambiado = True
    while cambiado:
        cambiado = False
        for i in range(len(grupos)):
            for j in range(i + 1, len(grupos)):
                a = grupos[i]
                ampliado = fitz.Rect(a.x0 - hueco, a.y0 - hueco, a.x1 + hueco, a.y1 + hueco)
                if ampliado.intersects(grupos[j]):
                    grupos[i] = a | grupos[j]
                    del grupos[j]
                    cambiado = True
                    break
            if cambiado:
                break
    return grupos


def _figuras_de_pagina(page, bloques, xrefs_decorativos: Optional[set] = None) -> List[Any]:
    """Rectángulos de figuras (dibujos vectoriales o imágenes) de la página, sin marcos ni decoración."""
    ancho, alto = page.rect.width, page.rect.height
    etiquetas = [fitz.Rect(b[:4]) for b in bloques
                 if RE_ETIQUETA_PREG.match(b[4].strip()) or RE_ETIQUETA_ALT.match(b[4].strip())]
    etiquetas_preg = [fitz.Rect(b[:4]) for b in bloques if RE_ETIQUETA_PREG.match(b[4].strip())]
    candidatos: List[Any] = []
    largos = [bl for bl in bloques if len(bl[4].strip()) > 40]

    reglas: List[Any] = []   # líneas negras horizontales largas: delimitan recuadros de enunciado
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.is_empty and r.width < 0.5 and r.height < 0.5:
            continue
        color = d.get("color")
        if (r.height < 2 and r.width > 0.5 * ancho and 40 < r.y0 < 785
                and color is not None and max(color) < 0.35):
            reglas.append(r)
        if r.y1 < 40 or r.y0 > 785:                                   # encabezado / pie (incluye logo)
            continue
        if r.width * r.height > 0.45 * ancho * alto:                  # marco de página
            continue
        if r.width > 0.8 * ancho and r.height > 0.3 * alto:           # contenedor grande
            continue
        if min(r.width, r.height) < 2 and (max(r.width, r.height) > 0.6 * ancho or r.x0 <= 60):
            continue                                                  # reglas y bordes laterales del marco
        if any(_rect_en(r, e, 14.0) for e in etiquetas):              # fondo de "Pregunta N"/"Alternativa X"
            continue
        if r.width < 150 and r.height < 40 and any(
            r.intersects(fitz.Rect(e.x0 - 10, e.y0 - 10, e.x1 + 40, e.y1 + 10)) for e in etiquetas
        ):
            continue                                                  # adornos junto a las etiquetas
        if (r.width > 200 or r.height > 150) and sum(
            1 for bl in largos if _rect_en(fitz.Rect(bl[:4]), r, 10.0)
        ) >= 1:
            continue                                                  # marcos/recuadros que rodean texto
        candidatos.append(r)

    try:
        for info in page.get_image_info(xrefs=True):
            r = fitz.Rect(info["bbox"])
            if xrefs_decorativos and info.get("xref") in xrefs_decorativos:
                continue                                              # logos/adornos repetidos en varias páginas
            if r.width / max(r.height, 1) > 3.5 and r.height < 90:
                continue                                              # banners tipo logotipo
            if r.width >= 20 and r.height >= 20 and r.width * r.height < 0.6 * ancho * alto and 40 < r.y0 < 805:
                candidatos.append(r)
    except Exception:
        pass

    figuras = []
    for g in _agrupar_rects(candidatos):
        if g.width < 25 or g.height < 25:
            continue
        if g.y0 > 770:
            continue                                                  # logotipo del pie de página
        if g.y1 < 100 and g.height < 50:
            continue                                                  # rótulos de sección en el encabezado
        if any(-14 <= g.y0 - e.y1 <= 16 and abs(g.x0 - e.x0) < 25 for e in etiquetas_preg):
            continue                                                  # marco pegado bajo "Pregunta N"
        if g.width > 150 and (
            any(g.intersects(fitz.Rect(e.x0 - 6, e.y0 - 6, e.x1 + 6, e.y1 + 6)) for e in etiquetas_preg)
            or sum(1 for e in etiquetas if g.intersects(e)) >= 2
        ):
            continue                                                  # marco de una pregunta completa
        if sum(1 for bl in largos if _rect_en(fitz.Rect(bl[:4]), g, 10.0)) >= 2:
            continue                                                  # agrupó texto corrido: no es una figura
        # Incluye rótulos cortos cercanos (ej. "1 cm", "A", "x") para que la figura quede completa
        for b in bloques:
            br = fitz.Rect(b[:4])
            if b[1] < 795 and len(b[4].strip()) <= 70 and not RE_ETIQUETA_ALT.match(b[4].strip()) and not RE_ETIQUETA_PREG.match(b[4].strip()) \
                    and fitz.Rect(g.x0 - 18, g.y0 - 18, g.x1 + 18, g.y1 + 18).intersects(br):
                g = g | br
        # Si la figura está dentro de un recuadro delimitado por dos líneas negras (enunciado + gráfico),
        # se recorta el recuadro completo, con sus líneas, tal como se ve en el cuadernillo.
        arriba = [r for r in reglas if r.y0 <= g.y0 + 2 and g.y0 - r.y0 < 220 and r.x0 < g.x1 and r.x1 > g.x0]
        abajo = [r for r in reglas if r.y0 >= g.y1 - 2 and r.y0 - g.y1 < 120 and r.x0 < g.x1 and r.x1 > g.x0]
        if arriba and abajo:
            ra = max(arriba, key=lambda r: r.y0)
            rb = min(abajo, key=lambda r: r.y0)
            caja = fitz.Rect(min(ra.x0, rb.x0), ra.y0 - 1, max(ra.x1, rb.x1), rb.y1 + 1)
            if not any(caja.intersects(e) for e in etiquetas_preg):
                g = g | caja
        figuras.append(g)
    # Los rótulos compartidos ("Figura 1  Figura 2  Figura 3") pueden unir/solapar figuras vecinas:
    # se fusionan las que quedaron superpuestas para no duplicar recortes parciales.
    return _agrupar_rects(figuras, hueco=0.0)


def extraer_figuras(ruta_pdf: str, numeros: List[int], dir_salida: str) -> Dict[int, List[str]]:
    """Recorta cada figura y la asocia a la pregunta que la precede en el orden de lectura."""
    if fitz is None:
        return {}
    conocidas = set(numeros)
    resultado: Dict[int, List[str]] = {}
    actual: Optional[int] = None
    ultimo = 0

    with fitz.open(ruta_pdf) as doc:
        usos: Dict[int, int] = {}
        for page in doc:
            for img in page.get_images(full=True):
                usos[img[0]] = usos.get(img[0], 0) + 1
        decorativos = {x for x, n in usos.items() if n >= 2}

        for page in doc:
            bloques = page.get_text("blocks")
            mid_x = page.rect.width / 2
            eventos: List[Tuple[int, float, str, Any]] = []   # (columna, y, tipo, dato)

            def columna(x0: float, x1: float) -> int:
                return 0 if (x0 + x1) / 2 < mid_x else 1

            for b in bloques:
                texto = b[4].strip()
                m = RE_ETIQUETA_PREG.match(texto)
                numero = int(m.group(1)) if m else None
                if numero is None:
                    m2 = RE_PREG_NUM.match(texto.splitlines()[0]) if texto else None
                    if m2 and int(m2.group(1)) == ultimo + 1 and int(m2.group(1)) in conocidas:
                        numero = int(m2.group(1))
                if numero is not None and numero in conocidas:
                    eventos.append((columna(b[0], b[2]), b[1], "preg", numero))
                    ultimo = max(ultimo, numero)

            for r in _figuras_de_pagina(page, bloques, decorativos):
                eventos.append((columna(r.x0, r.x1), r.y0, "fig", r))

            # Una sola columna: el orden es solo vertical (igual que extraer_texto_paginas)
            dos_columnas = any(e[0] == 1 for e in eventos if e[2] == "preg") and any(e[0] == 0 for e in eventos if e[2] == "preg")
            eventos.sort(key=lambda e: ((e[0] if dos_columnas else 0), e[1], 0 if e[2] == "preg" else 1))

            for _col, _y, tipo, dato in eventos:
                if tipo == "preg":
                    actual = dato
                elif actual is not None and len(resultado.get(actual, [])) < MAX_FIGURAS_POR_PREGUNTA:
                    os.makedirs(dir_salida, exist_ok=True)
                    nombre = f"q{actual}_{len(resultado.get(actual, [])) + 1}.png"
                    clip = fitz.Rect(dato.x0 - 6, dato.y0 - 6, dato.x1 + 6, dato.y1 + 6) & page.rect
                    page.get_pixmap(clip=clip, dpi=160).save(os.path.join(dir_salida, nombre))
                    resultado.setdefault(actual, []).append(nombre)
    return resultado


def extraer_clave_desde_pdf(ruta_respuestas: str) -> Dict[int, str]:
    """Extrae respuestas correctas desde el PDF de claves (matriz de letras o lista numerada)."""
    respuestas: Dict[int, str] = {}

    # Método 1 (pypdfium2): Matriz condensada de letras continuas
    if pdfium is not None:
        try:
            with pdfium.PdfDocument(ruta_respuestas) as doc:
                texto = "\n".join(p.get_textpage().get_text_range() or "" for p in doc)
                lineas = [l.strip() for l in texto.splitlines() if re.match(r"^[A-E\s]{15,}$", l.strip())]
                if len(lineas) >= 2:
                    letras = []
                    for bloque in lineas[-2:]:
                        letras.extend(bloque.split())
                    return {i: l.upper() for i, l in enumerate(letras, 1)}
        except Exception:
            pass

    # Método 2: Líneas numeradas ("1. B", "1 B", "1 - B")
    try:
        texto = ""
        if fitz is not None:
            with fitz.open(ruta_respuestas) as doc:
                texto = "\n".join(p.get_text() for p in doc)
        elif pdfplumber is not None:
            with pdfplumber.open(ruta_respuestas) as pdf:
                texto = "\n".join(p.extract_text() or "" for p in pdf.pages)

        for linea in texto.splitlines():
            m = re.search(r"^\s*(\d{1,3})\s*[\.\:\-\)\–\t ]+\s*([A-Ea-e])\b", linea)
            if m:
                respuestas[int(m.group(1))] = m.group(2).upper()
    except Exception:
        pass

    return respuestas


def procesar_examen(
    ruta_preguntas: str,
    ruta_respuestas: Optional[str] = None,
    clave_texto: Optional[str] = None,
    anio: int = 2025,
    curso: str = "General",
    ruta_salida: Optional[str] = None,
    dir_figuras: Optional[str] = None
) -> Dict[str, Any]:
    """Flujo principal: lee PDF, agrupa preguntas, asigna respuestas correctas y guarda JSON."""
    paginas = extraer_texto_paginas(ruta_preguntas)
    preguntas = agrupar_preguntas(paginas, anio, curso)

    if not preguntas:
        raise ValueError("No se encontraron preguntas legibles en el PDF proporcionado.")

    # Claves desde PDF o texto plano
    clave_dict = extraer_clave_desde_pdf(ruta_respuestas) if ruta_respuestas and os.path.exists(ruta_respuestas) else {}
    if clave_texto:
        clave_limpia = re.sub(r"[^A-Ea-e]", "", clave_texto).upper()
        clave_dict.update({i: c for i, c in enumerate(clave_limpia, 1)})

    # Asignar clave a cada pregunta
    for q in preguntas:
        if q["numero"] in clave_dict:
            q["correcta"] = clave_dict[q["numero"]]

    # Figuras (gráficos vectoriales o imágenes) recortadas por pregunta
    total_figuras = 0
    if dir_figuras:
        try:
            por_pregunta = extraer_figuras(ruta_preguntas, [q["numero"] for q in preguntas], dir_figuras)
        except Exception:
            por_pregunta = {}
        for q in preguntas:
            if q["numero"] in por_pregunta:
                q["figuras"] = por_pregunta[q["numero"]]
                total_figuras += len(q["figuras"])

    # Guardar JSON si se indicó ruta
    if ruta_salida:
        os.makedirs(os.path.dirname(os.path.abspath(ruta_salida)), exist_ok=True)
        with open(ruta_salida, "w", encoding="utf-8") as f:
            json.dump(preguntas, f, ensure_ascii=False, indent=2)

    return {
        "ok": True,
        "totalPreguntas": len(preguntas),
        "conRespuestas": sum(1 for q in preguntas if q.get("correcta")),
        "totalFiguras": total_figuras,
        "anio": anio,
        "curso": curso,
        "ruta_salida": ruta_salida or ""
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Desglosa un PDF de examen en preguntas JSON.")
    parser.add_argument("pdf", help="Ruta al PDF de preguntas")
    parser.add_argument("-r", "--respuestas", help="Ruta al PDF de respuestas (opcional)", default=None)
    parser.add_argument("-c", "--clave", help="Clave de respuestas en texto, ej: BBCCAA... (opcional)", default=None)
    parser.add_argument("-a", "--anio", type=int, default=2025, help="Año del examen")
    parser.add_argument("-k", "--curso", default="General", help="Nombre del curso")
    parser.add_argument("-o", "--salida", default="salida.json", help="Ruta del archivo JSON de salida")

    parser.add_argument("-f", "--figuras", default=None, help="Directorio donde guardar las figuras recortadas (opcional)")

    args = parser.parse_args()

    try:
        resultado = procesar_examen(
            ruta_preguntas=args.pdf,
            ruta_respuestas=args.respuestas,
            clave_texto=args.clave,
            anio=args.anio,
            curso=args.curso,
            ruta_salida=args.salida,
            dir_figuras=args.figuras
        )
        print(json.dumps(resultado, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
