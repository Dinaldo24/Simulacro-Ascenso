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
    r"^(?:lea\s+(?:la\s+siguiente\s+(?:situaci[o\u00f3]n|descripci[o\u00f3]n|lectura)|el\s+siguiente\s+(?:texto|caso|fragmento))|a\s+continuaci[o\u00f3]n.*?)\s+y\s+responda\s+las?\s+preguntas?\s+([\d,\s]+(?:\s*(?:y|al?)\s*\d+)?)",
    re.I
)
RE_CTX_EN = re.compile(
    r"^(?:read\s+(?:the\s+following\s+(?:situation|text)|this\s+text)).*?(?:answer\s+questions?)\s*([\d,\s\-\u2013]+(?:\s*(?:and|to)\s*\d+)?)",
    re.I
)
RE_CLOZE_HDR = re.compile(
    r"^(?:cloze\b|read\s+the\s+following\s+text\s+and\s+choose\s+the\s+best\s+alternative\s+to\s+fill\s+in\s+the\s+blanks)",
    re.I
)

# Pies de página, notas y metadatos descartables
RE_PIE = re.compile(
    r"(^\d+\s*\|?\s*A\d+-[A-Z]+-\d+.*$)|(^A\d+-[A-Z]+-\d+\s*/.*$)|(^Nota\.)|(^P[a\u00e1]gina\s+\d+)|(^Adapted from)|(^Retrieved\s+[A-Za-z0-9]+)",
    re.I
)


def _extraer_rango_ctx(linea: str) -> Optional[List[int]]:
    """Extrae la lista ordenada de números de pregunta referenciados en un encabezado de contexto."""
    m = RE_CTX_ES.search(linea) or RE_CTX_EN.search(linea)
    if not m:
        return None
    nums = [int(n) for n in re.findall(r"\b\d+\b", m.group(1))]
    return list(range(min(nums), max(nums) + 1)) if nums else None


def _partir_en_linea(letra: str, resto: str) -> List[Tuple[str, str]]:
    """Separa múltiples alternativas si vienen en una sola línea (ej. 'A) 10  B) 20  C) 30' o 'A)  B)  C)')."""
    letra = letra.upper()
    if letra not in LETRAS:
        return [(letra, resto.strip())]

    partes: List[Tuple[str, str]] = []
    idx = LETRAS.index(letra)
    while idx + 1 < len(LETRAS):
        sig = LETRAS[idx + 1]
        clase_sig = f"[{sig}{sig.lower()}]"
        patron = (
            r"(?:^|\s)(?:(?:alternativa|alt\.?|opci[o\u00f3]n|option|opt\.?|rpta\.?)\s+"
            + r"[\(\[\{]?" + clase_sig + r"[\)\]\}\.\-\u2013:]*"
            + r"|[\(\[\{]?" + clase_sig + CIERRE + r"+)(?=\s|$)"
        )
        m = re.search(patron, resto, re.I)
        if not m:
            break
        partes.append((LETRAS[idx], resto[:m.start()].strip()))
        resto, idx = resto[m.end():].strip(), idx + 1
    partes.append((LETRAS[idx], resto.strip()))
    return partes


def _primera_linea(b: Tuple[Any, ...]) -> str:
    """Devuelve la primera línea no vacía de un bloque de texto PyMuPDF."""
    lineas = b[4].strip().splitlines()
    return lineas[0] if lineas else ""


def _texto_bloque(b: Tuple[Any, ...]) -> str:
    """Normaliza saltos internos en encabezados de contexto envueltos para evitar rupturas del patrón."""
    txt = b[4]
    st = txt.strip()
    if "\n" in st and re.match(r"^(?:lea\s+|read\s+|a\s+continuaci[o\u00f3]n\b)", st, re.I) \
            and not re.search(r"^(?:pregunta|question|alternativa|option)\b", st, re.M | re.I):
        return " ".join(st.split())
    return txt


def _dividir_dos_columnas(content: List[Tuple[Any, ...]], mid_x: float) -> Optional[Tuple[List[Tuple[Any, ...]], List[Tuple[Any, ...]], List[Tuple[Any, ...]]]]:
    """Detecta páginas con lectura en columna izquierda y preguntas/opciones en columna derecha (p. ej. CLOZE)."""
    top = [
        b for b in content
        if b[1] < 125 and (
            (b[0] < mid_x - 30 and b[2] > mid_x + 30)
            or RE_CLOZE_HDR.match(b[4].strip())
        )
    ]
    top_ids = {id(b) for b in top}
    body = [b for b in content if id(b) not in top_ids]
    r_anchors = [
        b for b in body
        if b[0] >= mid_x - 10 and (
            RE_PREG_PALABRA.match(_primera_linea(b))
            or RE_ALT_PALABRA.match(_primera_linea(b))
        )
    ]
    if len(r_anchors) < 2:
        return None
    split_x = min(b[0] for b in r_anchors) - 8.0
    left = sorted([b for b in body if b[2] <= split_x], key=lambda b: b[1])
    right = sorted([b for b in body if b[0] >= split_x], key=lambda b: b[1])
    if len(left) < 2:
        return None
    return (sorted(top, key=lambda b: b[1]), left, right)


def extraer_texto_paginas(ruta_pdf: str) -> List[str]:
    """Extrae texto página por página ordenando visualmente dos columnas (left-to-right, top-to-bottom)."""
    paginas: List[str] = []

    # Intento principal con PyMuPDF: detecta columnas por posición X y agrupa pasajes CLOZE multipágina
    if fitz is not None:
        try:
            with fitz.open(ruta_pdf) as doc:
                pag_data = []
                for page in doc:
                    blocks = page.get_text("blocks")
                    mid_x = page.rect.width / 2
                    # Ignora bloques vacíos o de imagen, encabezados (<35) y pies (>805)
                    content = [
                        b for b in blocks
                        if (len(b) < 7 or b[6] == 0)
                        and b[4].strip()
                        and not (b[1] > 805 or (b[1] < 35 and len(b[4].strip()) < 10))
                    ]
                    pag_data.append((content, _dividir_dos_columnas(content, mid_x)))

                i = 0
                while i < len(pag_data):
                    content, cols = pag_data[i]
                    if cols is not None:
                        top, left, right = cols
                        es_cloze = any(RE_CLOZE_HDR.match(b[4].strip()) for b in top + left)
                        if es_cloze:
                            # Une toda la lectura de la columna izquierda mientras las páginas siguientes mantengan CLOZE
                            grupo_left = list(left)
                            derechas = [right]
                            j = i + 1
                            while j < len(pag_data) and pag_data[j][1] is not None:
                                top_j, left_j, right_j = pag_data[j][1]
                                if any(RE_PREG_PALABRA.match(_primera_linea(b)) for b in left_j):
                                    break
                                grupo_left.extend(top_j)
                                grupo_left.extend(left_j)
                                derechas.append(right_j)
                                j += 1

                            qnums = []
                            for rb in derechas:
                                for b in rb:
                                    m = RE_PREG_PALABRA.match(_primera_linea(b))
                                    if m:
                                        qnums.append(int(m.group(1)))
                            hdr_lineas = [" ".join(b[4].split()) for b in top if not b[4].strip().upper() == "CLOZE"]
                            hdr_base = hdr_lineas[0] if hdr_lineas else "Read the following text and choose the best alternative to fill in the blanks."
                            if qnums:
                                ctx_line = f"Read the following text and answer questions {min(qnums)} to {max(qnums)}."
                                pasaje = [ctx_line, hdr_base]
                            else:
                                pasaje = ["\n".join(hdr_lineas)]
                            pasaje.extend(_texto_bloque(b) for b in grupo_left if not RE_PIE.search(b[4].strip()))
                            paginas.append("\n".join(pasaje + [_texto_bloque(b) for b in derechas[0]]))
                            for rb in derechas[1:]:
                                paginas.append("\n".join(_texto_bloque(b) for b in rb))
                            i = j
                            continue
                        ordered = top + left + right
                    else:
                        ordered = sorted(content, key=lambda b: b[1])

                    paginas.append("\n".join(_texto_bloque(b) for b in ordered))
                    i += 1

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

            # 1. Contexto compartido (Español: "preguntas 10, 11 y 12" o Inglés: "questions 6, 7 and 8" / CLOZE)
            nums_ctx = _extraer_rango_ctx(linea)
            if nums_ctx:
                _flush_ctx()
                ctx_para, ctx_buf, destino = nums_ctx, [], ("ctx", None)
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
                    cand_resto = (m_num.group(2) or "").strip()
                    es_espacio_blanco = bool(re.match(r"^(?:_{2,}|\.{3,}|\u2026)", cand_resto))
                    en_cloze = bool(destino and destino[0] == "ctx" and ctx_buf and RE_CLOZE_HDR.match(" ".join(ctx_buf)))
                    if not es_espacio_blanco and not en_cloze:
                        numero, resto = int(m_num.group(1)), cand_resto

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
            if not q["enunciado"].strip() and RE_CLOZE_HDR.match(q["contexto"]):
                q["enunciado"] = f"Choose the best alternative to fill in blank ({q['numero']})."

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
RE_ETIQUETA_ALT = re.compile(
    r"^(?:alternativa|alt\.?|opci[o\u00f3]n|option|opt\.?|rpta\.?)\s*[\(\[\{]?([A-E])[\)\]\}\.\-\u2013:]*(?:\s|$)",
    re.I,
)
RE_MARCA_ALT_SOLO = re.compile(r"^[\(\[\{]?([A-Ea-e])" + CIERRE + r"+$")
RE_ROTULO_FIG = re.compile(r"^(?:imagen|figura|tabla|gr[a\u00e1]fico)\s+\d+", re.I)
MAX_FIGURAS_POR_PREGUNTA = 10


def _rect_norm(r) -> Any:
    """Garantiza grosor mínimo de 1 pt para que trazos rectos (width=0 o height=0) no queden vacíos."""
    rr = fitz.Rect(r)
    if rr.width < 1.0:
        cx = (rr.x0 + rr.x1) / 2.0
        rr.x0, rr.x1 = cx - 0.5, cx + 0.5
    if rr.height < 1.0:
        cy = (rr.y0 + rr.y1) / 2.0
        rr.y0, rr.y1 = cy - 0.5, cy + 0.5
    return rr


def _rect_en(r, contenedor, margen: float = 4.0) -> bool:
    return (r.x0 >= contenedor.x0 - margen and r.x1 <= contenedor.x1 + margen
            and r.y0 >= contenedor.y0 - margen and r.y1 <= contenedor.y1 + margen)


def _dist_rects(a, b) -> float:
    dx = max(0.0, a.x0 - b.x1, b.x0 - a.x1)
    dy = max(0.0, a.y0 - b.y1, b.y0 - a.y1)
    return (dx * dx + dy * dy) ** 0.5


def _agrupar_rects(rects: List[Any], hueco: float = 12.0) -> List[Any]:
    """Une rectángulos cercanos (unión-búsqueda) y devuelve el rectángulo que cubre cada grupo."""
    if not rects:
        return []
    grupos = [_rect_norm(r) for r in rects]
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


def _contar_ejes_unicos(valores: List[float], tol: float = 3.0) -> int:
    if not valores:
        return 0
    orden = sorted(valores)
    grupos = [orden[0]]
    for v in orden[1:]:
        if v - grupos[-1] > tol:
            grupos.append(v)
    return len(grupos)


def _es_tabla(g, seg_h: List[Any], seg_v: List[Any], etiquetas: List[Any]) -> bool:
    """Reconoce tablas reales con cuadrícula interna (filas y columnas separadas por trazos oscuros)."""
    if any(g.intersects(e) for e in etiquetas):
        return False
    xs_int = [(r.x0 + r.x1) / 2.0 for r in seg_v
              if g.intersects(r) and r.height >= 12 and g.x0 + 8 < (r.x0 + r.x1) / 2.0 < g.x1 - 8]
    ys_int = [(r.y0 + r.y1) / 2.0 for r in seg_h
              if g.intersects(r) and r.width >= 20 and g.y0 + 8 < (r.y0 + r.y1) / 2.0 < g.y1 - 8]
    return _contar_ejes_unicos(xs_int) >= 1 and _contar_ejes_unicos(ys_int) >= 1


def _es_prosa_cuerpo(b: Tuple[Any, ...]) -> bool:
    """True para párrafos de enunciado al margen izquierdo que nunca deben absorberse como rótulo."""
    txt = b[4].strip()
    return b[0] < 85 and b[2] > 300 and len(txt) > 25 and not RE_ROTULO_FIG.match(txt)


def _agregar_zonas_formulas(
    candidatos: List[Any],
    bloques: List[Any],
    etiquetas: List[Any],
    math_strokes: List[Any],
) -> List[Any]:
    """Preserva fórmulas matemáticas vectoriales complejas (p. ej. raíz de Herón o fracciones centradas)."""
    zonas: List[Any] = []
    indented = [b for b in bloques if b[0] >= 125 and b[2] <= 515 and b[1] > 40 and b[3] < 785
                and not RE_ETIQUETA_PREG.match(b[4].strip()) and not RE_ETIQUETA_ALT.match(b[4].strip())]
    for sr in math_strokes:
        if any(sr.intersects(fitz.Rect(e.x0 - 8, e.y0 - 8, e.x1 + 8, e.y1 + 8)) for e in etiquetas):
            continue
        tocados = [fitz.Rect(b[:4]) for b in indented if fitz.Rect(b[:4]).intersects(
            fitz.Rect(sr.x0 - 6, sr.y0 - 6, sr.x1 + 6, sr.y1 + 6)
        )]
        if not tocados:
            continue
        zona = sr
        for tr in tocados:
            zona = zona | tr
        # Agrupa renglones contiguos de la misma fórmula (título arriba o definición abajo)
        for _ in range(3):
            crecio = False
            for b in indented:
                br = fitz.Rect(b[:4])
                if not _rect_en(br, zona, 0.5) and fitz.Rect(zona.x0 - 20, zona.y0 - 14, zona.x1 + 20, zona.y1 + 14).intersects(br):
                    zona = zona | br
                    crecio = True
            if not crecio:
                break
        if zona.width >= 25 and zona.height >= 25:
            candidatos.append(zona)
            zonas.append(zona)
    return zonas


def _recortar_borde_vacio(g, bloques: List[Any], images_rects: List[Any], seg_h: List[Any]) -> Any:
    """Recorta extensiones vacías de bordes de tabla que invaden un párrafo de texto inferior."""
    for b in bloques:
        if not _es_prosa_cuerpo(b):
            continue
        br = fitz.Rect(b[:4])
        if g.y0 + 25 < br.y0 < g.y1 and br.x0 < g.x1 and br.x1 > g.x0:
            hay_contenido_abajo = any(
                bb[4].strip() and fitz.Rect(bb[:4]) != br
                and bb[0] >= g.x0 - 2 and bb[2] <= g.x1 + 2
                and br.y0 - 2 <= bb[1] < g.y1 + 2
                for bb in bloques
            ) or any(im.y1 > br.y0 + 2 and g.intersects(im) for im in images_rects)
            if hay_contenido_abajo:
                continue
            h_arriba = [s for s in seg_h if g.intersects(s) and s.y1 <= br.y0 - 2.0 and s.y0 >= g.y0 + 20.0]
            nuevo_y1 = (max(s.y1 for s in h_arriba) + 2.0) if h_arriba else (br.y0 - 2.0)
            nuevo_y1 = min(nuevo_y1, br.y0 - 2.0)
            if nuevo_y1 - g.y0 >= 25.0:
                g = fitz.Rect(g.x0, g.y0, g.x1, nuevo_y1)
    return g


def _figuras_de_pagina(page, bloques, xrefs_decorativos: Optional[set] = None) -> List[Any]:
    """Rectángulos de figuras, tablas o fórmulas de la página, sin marcos ni decoración."""
    ancho, alto = page.rect.width, page.rect.height
    etiquetas = [fitz.Rect(b[:4]) for b in bloques
                 if RE_ETIQUETA_PREG.match(b[4].strip())
                 or RE_ETIQUETA_ALT.match(_primera_linea(b))
                 or RE_MARCA_ALT_SOLO.match(b[4].strip())]
    etiquetas_preg = [fitz.Rect(b[:4]) for b in bloques if RE_ETIQUETA_PREG.match(b[4].strip())]
    candidatos: List[Any] = []
    largos = [bl for bl in bloques if len(bl[4].strip()) > 40]

    reglas: List[Any] = []
    seg_h: List[Any] = []
    seg_v: List[Any] = []
    math_strokes: List[Any] = []
    crudos_dibujos: List[Tuple[Any, float, float]] = []

    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        rw, rh = r.width, r.height
        if r.is_empty and rw < 0.5 and rh < 0.5:
            continue
        color = d.get("color")
        fill = d.get("fill")
        nr = _rect_norm(r)

        if (rh < 2 and rw > 0.5 * ancho and 40 < r.y0 < 785
                and color is not None and max(color) < 0.35):
            reglas.append(nr)
        if r.y1 < 40 or r.y0 > 785:                                   # encabezado / pie (incluye logo)
            continue
        if rw * rh > 0.45 * ancho * alto:                             # marco de página
            continue
        if rw > 0.8 * ancho and rh > 0.3 * alto:                      # contenedor grande
            continue
        if fill is None and color is not None and min(color) > 0.55 and rw > 0.65 * ancho and rh > 100:
            continue                                                  # marco gris exterior de pregunta
        if min(rw, rh) < 2 and (max(rw, rh) > 0.80 * ancho or r.x0 <= 65):
            continue                                                  # separadores de ancho completo y borde lateral
        if fill is None and rh < 2 and rw < 140 and color is not None and 0.10 < min(color) and max(color) < 0.25:
            continue                                                  # subrayado de énfasis en texto ("no", "metacognición")
        if any(_rect_en(nr, e, 14.0) for e in etiquetas):             # fondo de "Pregunta N"/"Alternativa X"
            continue
        if rw <= 42 and rh <= 30 and any(
            nr.intersects(fitz.Rect(e.x0 - 8, e.y0 - 6, e.x1 + 18, e.y1 + 6)) for e in etiquetas
        ):
            continue                                                  # casillas/adornos junto a etiquetas

        es_oscuro = (color is not None and max(color) < 0.55) or (fill is not None and max(fill) < 0.55)
        if es_oscuro:
            if rh < 2 and rw >= 10:
                seg_h.append(nr)
            elif rw < 2 and rh >= 10:
                seg_v.append(nr)
            if r.x0 >= 125 and 25 <= rw <= 220 and rh < 25:
                if (color == (0.0, 0.0, 0.0)) or (fill == (0.0, 0.0, 0.0)):
                    math_strokes.append(nr)
        crudos_dibujos.append((nr, rw, rh))

    for nr, rw, rh in crudos_dibujos:
        if (rw > 200 or rh > 150) and sum(
            1 for bl in largos if _rect_en(fitz.Rect(bl[:4]), nr, 10.0)
        ) >= 1 and not _es_tabla(nr, seg_h, seg_v, etiquetas):
            continue                                                  # marco aislado alrededor de prosa
        candidatos.append(nr)

    images_rects: List[Any] = []
    try:
        for info in page.get_image_info(xrefs=True):
            r = fitz.Rect(info["bbox"])
            if xrefs_decorativos and info.get("xref") in xrefs_decorativos:
                continue                                              # logos/adornos repetidos en varias páginas
            if r.width / max(r.height, 1) > 3.5 and r.height < 90:
                continue                                              # banners tipo logotipo
            if r.width >= 20 and r.height >= 20 and r.width * r.height < 0.6 * ancho * alto and 40 < r.y0 < 805:
                candidatos.append(r)
                images_rects.append(r)
    except Exception:
        pass

    zonas_formula = _agregar_zonas_formulas(candidatos, bloques, etiquetas, math_strokes)

    bases: List[Any] = []
    es_tabla_flag: List[bool] = []
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
        tabla = _es_tabla(g, seg_h, seg_v, etiquetas)
        en_formula = any(g.intersects(z) for z in zonas_formula)
        if not tabla and not en_formula and sum(1 for bl in largos if _rect_en(fitz.Rect(bl[:4]), g, 10.0)) >= 2:
            continue                                                  # agrupó texto corrido: no es una figura
        bases.append(g)
        es_tabla_flag.append(tabla)

    # Prepara rótulos elegibles y evita que rótulos entre dos figuras independientes las fusionen
    rotulos: List[Tuple[Tuple[Any, ...], Any, str]] = []
    for b in bloques:
        txt = b[4].strip()
        if not txt or b[1] >= 795 or b[1] < 38:
            continue
        lineas_b = [ln.strip() for ln in txt.splitlines() if ln.strip()]
        if RE_ETIQUETA_ALT.match(_primera_linea(b)) or RE_ALT_MARCA.match(_primera_linea(b)) \
                or (lineas_b and all(RE_ETIQUETA_ALT.match(ln) or RE_MARCA_ALT_SOLO.match(ln) for ln in lineas_b)) \
                or RE_ETIQUETA_PREG.match(txt) or _extraer_rango_ctx(" ".join(txt.split())) or RE_CLOZE_HDR.match(txt):
            continue
        if _es_prosa_cuerpo(b):
            continue
        max_len = 120 if b[0] >= 115 else 70
        if len(txt) <= max_len:
            rotulos.append((b, fitz.Rect(b[:4]), txt))

    figuras = []
    for idx, base_g in enumerate(bases):
        g = fitz.Rect(base_g)
        # Expansión iterativa (hasta 4 saltos) para capturar números de eje -> título eje -> título gráfico
        for _ in range(4):
            crecio = False
            zona = fitz.Rect(g.x0 - 26, g.y0 - 20, g.x1 + 26, g.y1 + 20)
            for _b, br, txt in rotulos:
                if _rect_en(br, g, 0.5) or not zona.intersects(br):
                    continue
                if RE_ROTULO_FIG.match(txt):
                    if txt.rstrip().endswith(":") and br.y0 >= g.y1 - 2:
                        continue                                      # "Imagen 2:" introduce la imagen inferior, nunca la superior
                    solapa_h = [j for j, fb in enumerate(bases)
                                if min(fb.x1, br.x1 + 26) > max(fb.x0, br.x0 - 26)]
                    if len(solapa_h) <= 1:
                        mas_cercana = min(range(len(bases)), key=lambda j: _dist_rects(bases[j], br))
                        if idx != mas_cercana:
                            continue
                else:
                    dist_propia = _dist_rects(base_g, br)
                    if any(j != idx and _dist_rects(fb, br) + 3.0 < dist_propia for j, fb in enumerate(bases)):
                        continue                                      # rótulo más cercano a otra figura vecina
                g = g | br
                crecio = True
            if not crecio:
                break

        # Recuadro entre dos líneas negras horizontales (resolución de estudiante + gráfico/fórmula)
        arriba = [r for r in reglas if r.y0 <= g.y0 + 2 and g.y0 - r.y0 < 220 and r.x0 < g.x1 and r.x1 > g.x0]
        abajo = [r for r in reglas if r.y0 >= g.y1 - 2 and r.y0 - g.y1 < 120 and r.x0 < g.x1 and r.x1 > g.x0]
        if arriba and abajo:
            ra = max(arriba, key=lambda r: r.y0)
            rb = min(abajo, key=lambda r: r.y0)
            caja = fitz.Rect(min(ra.x0, rb.x0), ra.y0 - 1, max(ra.x1, rb.x1), rb.y1 + 1)
            cruza_prosa = any(_es_prosa_cuerpo(b) and caja.intersects(fitz.Rect(b[:4])) for b in bloques)
            cruza_otra = any(j != idx and caja.intersects(fb) for j, fb in enumerate(bases))
            if not cruza_prosa and not cruza_otra and not any(caja.intersects(e) for e in etiquetas):
                g = g | caja

        if es_tabla_flag[idx]:
            g = _recortar_borde_vacio(g, bloques, images_rects, seg_h)
        figuras.append(g)

    # Los rótulos compartidos ("Figura 1  Figura 2  Figura 3") pueden unir/solapar figuras vecinas:
    # se fusionan las que quedaron superpuestas para no duplicar recortes parciales.
    return _agrupar_rects(figuras, hueco=0.0)


def _bloque_entre(bloques: List[Any], y0: float, y1: float, excluir_rect) -> bool:
    """True si existe texto relevante entre el rótulo 'Alternativa X' y la figura siguiente."""
    for b in bloques:
        txt = b[4].strip()
        if not txt:
            continue
        br = fitz.Rect(b[:4])
        if _rect_en(br, excluir_rect, 2.0):
            continue
        if br.y0 >= y0 - 2 and br.y1 <= y1 + 2 and not RE_ETIQUETA_ALT.match(txt):
            return True
    return False


def _ajustar_clip(page, rect_recorte, bloques, pad: float = 6.0):
    """Aplica margen al recorte evitando invadir líneas de texto externas adyacentes."""
    x0, y0, x1, y1 = rect_recorte.x0 - pad, rect_recorte.y0 - pad, rect_recorte.x1 + pad, rect_recorte.y1 + pad
    for b in bloques:
        if (len(b) >= 7 and b[6] != 0) or not b[4].strip():
            continue
        br = fitz.Rect(b[:4])
        if (br & rect_recorte).get_area() > 0.2 * max(br.get_area(), 1.0):
            continue
        if br.x1 > x0 and br.x0 < x1:
            if br.y1 <= rect_recorte.y0 + 1.0 and br.y1 > y0:
                y0 = max(y0, min(rect_recorte.y0, br.y1 + 0.5))
            if br.y0 >= rect_recorte.y1 - 1.0 and br.y0 < y1:
                y1 = min(y1, max(rect_recorte.y1, br.y0 - 0.5))
        if br.y1 > rect_recorte.y0 and br.y0 < rect_recorte.y1:
            if br.x1 <= rect_recorte.x0 + 1.0 and br.x1 > x0:
                x0 = max(x0, min(rect_recorte.x0, br.x1 + 0.5))
            if br.x0 >= rect_recorte.x1 - 1.0 and br.x0 < x1:
                x1 = min(x1, max(rect_recorte.x1, br.x0 - 0.5))
    return fitz.Rect(x0, y0, x1, y1) & page.rect


RE_PALABRA_ALT_SOLO = re.compile(r"^(?:alternativa|alt\.?|opci[o\u00f3]n|option|opt\.?|rpta\.?)$", re.I)
RE_LETRA_SOLA_ALT = re.compile(r"^[\(\[\{]?([A-Ea-e])[\)\]\}\.\-\u2013:]*$")


def _marcadores_alt_en_bloque(page, b) -> List[Tuple[str, Any, bool]]:
    """Extrae uno o varios marcadores de alternativa (letra, rect, es_palabra) dentro de un bloque."""
    texto = b[4].strip()
    l0 = _primera_linea(b)
    if not (RE_ETIQUETA_ALT.match(l0) or RE_ALT_MARCA.match(l0) or RE_MARCA_ALT_SOLO.match(texto)):
        # También revisa si un bloque de opciones horizontales empieza más adelante o en líneas siguientes
        if not any(RE_ETIQUETA_ALT.match(ln.strip()) or RE_ALT_MARCA.match(ln.strip()) for ln in texto.splitlines()):
            return []

    clip_b = fitz.Rect(b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1)
    words = sorted(page.get_text("words", clip=clip_b), key=lambda w: (w[5], w[6], w[0]))
    encontrados: List[Tuple[str, Any, bool]] = []
    idx = 0
    while idx < len(words):
        w = words[idx]
        wtxt = w[4].strip()
        es_inicio_linea = (idx == 0) or (words[idx - 1][5] != w[5]) or (words[idx - 1][6] != w[6])
        tiene_salto_h = (not es_inicio_linea) and (w[0] - words[idx - 1][2] >= 8.0)

        if es_inicio_linea or tiene_salto_h:
            if RE_PALABRA_ALT_SOLO.match(wtxt) and idx + 1 < len(words):
                wn = words[idx + 1]
                ml = RE_LETRA_SOLA_ALT.match(wn[4].strip())
                if wn[5] == w[5] and wn[6] == w[6] and ml:
                    rect = fitz.Rect(w[:4]) | fitz.Rect(wn[:4])
                    encontrados.append((ml.group(1).upper(), rect, True))
                    idx += 2
                    continue
            if RE_MARCA_ALT_SOLO.match(wtxt):
                mm = RE_MARCA_ALT_SOLO.match(wtxt)
                if mm:
                    encontrados.append((mm.group(1).upper(), fitz.Rect(w[:4]), False))
                    idx += 1
                    continue
        idx += 1

    if encontrados:
        return encontrados

    m_pal = RE_ETIQUETA_ALT.match(l0)
    if m_pal:
        return [(m_pal.group(1).upper(), fitz.Rect(b[0], b[1], b[2], min(b[3], b[1] + 22)), True)]
    m_mar = RE_ALT_MARCA.match(l0)
    if m_mar:
        return [(m_mar.group(1).upper(), fitz.Rect(b[0], b[1], b[2], min(b[3], b[1] + 22)), False)]
    return []


def _agrupar_filas_alt(alts: List[Tuple[str, Any]]) -> List[List[Tuple[str, Any]]]:
    """Agrupa marcadores de alternativa por fila visual horizontal (tol 22 pt)."""
    if not alts:
        return []
    orden = sorted(alts, key=lambda it: ((it[1].y0 + it[1].y1) / 2.0, it[1].x0))
    filas: List[List[Tuple[str, Any]]] = [[orden[0]]]
    fila_yc = (orden[0][1].y0 + orden[0][1].y1) / 2.0
    for item in orden[1:]:
        yc = (item[1].y0 + item[1].y1) / 2.0
        if abs(yc - fila_yc) <= 22.0:
            filas[-1].append(item)
            fila_yc = sum((x[1].y0 + x[1].y1) / 2.0 for x in filas[-1]) / len(filas[-1])
        else:
            filas.append([item])
            fila_yc = yc
    for fila in filas:
        fila.sort(key=lambda it: it[1].x0)
    return filas


def _elegir_opcion_en_fila(fig, fila: List[Tuple[str, Any]]) -> str:
    """Asocia una figura horizontalmente a la alternativa dueña en una fila con >=2 opciones."""
    if len(fila) == 1:
        return fila[0][0]
    row_max_y1 = max(r.y1 for _, r in fila)
    if fig.y0 < row_max_y1 + 4.0:
        # Marcador a la izquierda de su figura: último marcador cuya x0 no supera el inicio de la figura
        cands = [i for i, (_, r) in enumerate(fila) if r.x0 <= fig.x0 + 8.0]
        return fila[cands[-1] if cands else 0][0]
    # Marcador encima de la figura: prioriza traslape horizontal único o centro más cercano
    solapan = [letra for letra, r in fila if r.x1 + 6.0 >= fig.x0 and r.x0 - 6.0 <= fig.x1]
    if len(solapan) == 1:
        return solapan[0]
    fig_cx = (fig.x0 + fig.x1) / 2.0
    return min(fila, key=lambda it: abs(fig_cx - (it[1].x0 + it[1].x1) / 2.0))[0]


def _asignar_figuras_de_pregunta(
    figs: List[Any],
    alts: List[Tuple[str, Any]],
    bloques: List[Any],
    alt_continuada: Optional[str] = None,
) -> List[Tuple[Optional[str], Any]]:
    """Clasifica cada figura de una pregunta como enunciado (None) o perteneciente a una alternativa ('A'..'E')."""
    if not alts:
        if alt_continuada and figs:
            # Solo continúa la opción previa en nueva página si no hay prosa larga arriba separándola
            return [
                (alt_continuada if not any(len(b[4].strip()) > 40 and b[3] <= f.y0 + 2 for b in bloques) else None, f)
                for f in figs
            ]
        return [(None, f) for f in figs]

    filas = _agrupar_filas_alt(alts)
    first_row = filas[0]
    first_y0 = min(r.y0 for _, r in first_row)

    # Detección opcional de rótulos debajo de figuras en fila horizontal ([fig A][fig B][fig C] + A) B) C))
    sobre_primera = [f for f in figs if f.y1 <= first_y0 + 2.0]
    capturas_bajo_fig = set()
    if len(first_row) >= 2:
        cerca = [
            f for f in sobre_primera
            if 0.0 <= first_y0 - f.y1 <= 30.0 and not _bloque_entre(bloques, f.y1, first_y0, f)
        ]
        if len(cerca) >= len(first_row):
            for idx_f, f in enumerate(figs):
                if f in cerca:
                    capturas_bajo_fig.add(idx_f)

    salida: List[Tuple[Optional[str], Any]] = []
    for idx_f, f in enumerate(figs):
        if idx_f in capturas_bajo_fig:
            fig_cx = (f.x0 + f.x1) / 2.0
            letra = min(first_row, key=lambda it: abs(fig_cx - (it[1].x0 + it[1].x1) / 2.0))[0]
            salida.append((letra, f))
            continue

        if f.y1 <= first_y0 + 2.0:
            if alt_continuada and not any(len(b[4].strip()) > 40 and b[3] <= f.y0 + 2 for b in bloques):
                salida.append((alt_continuada, f))
            else:
                salida.append((None, f))
            continue

        f_mid_y = (f.y0 + f.y1) / 2.0
        ri = 0
        for k, fila in enumerate(filas):
            if min(r.y0 for _, r in fila) <= f_mid_y + 4.0:
                ri = k
        letra = _elegir_opcion_en_fila(f, filas[ri])
        salida.append((letra, f))
    return salida


def extraer_figuras(ruta_pdf: str, numeros: List[int], dir_salida: str) -> Dict[int, Dict[str, Any]]:
    """Recorta figuras por pregunta y distingue si pertenecen al enunciado o a cada alternativa (A-E)."""
    if fitz is None:
        return {}
    conocidas = set(numeros)
    resultado: Dict[int, Dict[str, Any]] = {}

    with fitz.open(ruta_pdf) as doc:
        usos: Dict[int, int] = {}
        for page in doc:
            for img in page.get_images(full=True):
                usos[img[0]] = usos.get(img[0], 0) + 1
        decorativos = {x for x, n in usos.items() if n >= 2}

        # Fase 1: recolecta eventos de página ordenados para validar opciones A..E sin falsos positivos
        bloques_por_pag: List[List[Any]] = []
        slices_ctx: List[Tuple[int, List[int], Any]] = []
        slices_preg: Dict[int, List[Dict[str, Any]]] = {}

        actual: Optional[int] = None
        ctx_actual: Optional[List[int]] = None
        ultimo_q = 0

        for pidx, page in enumerate(doc):
            bloques = page.get_text("blocks")
            bloques_por_pag.append(bloques)
            mid_x = page.rect.width / 2
            eventos: List[Tuple[int, float, str, Any]] = []
            figs_pag = _figuras_de_pagina(page, bloques, decorativos)

            def columna(x0: float, x1: float) -> int:
                return 0 if (x0 + x1) / 2 < mid_x else 1

            for b in bloques:
                texto = b[4].strip()
                if not texto:
                    continue
                col = columna(b[0], b[2])
                nums_ctx = _extraer_rango_ctx(" ".join(texto.split()))
                if nums_ctx:
                    dests = [n for n in nums_ctx if n in conocidas]
                    if dests:
                        eventos.append((col, b[1], "ctx", dests))
                        continue

                l0 = _primera_linea(b)
                m = RE_ETIQUETA_PREG.match(texto)
                if m and int(m.group(1)) in conocidas:
                    eventos.append((col, b[1], "preg", int(m.group(1))))
                    continue

                if not RE_ORDINAL.match(l0):
                    m2 = RE_PREG_NUM.match(l0)
                    cand_resto = (m2.group(2) or "").strip() if m2 else ""
                    if m2 and int(m2.group(1)) in conocidas and not re.match(r"^(?:_{2,}|\.{3,}|\u2026)", cand_resto):
                        eventos.append((col, b[1], "cand_preg", int(m2.group(1))))
                        continue

                for letra, arect, es_pal in _marcadores_alt_en_bloque(page, b):
                    # Ignora marcas cortas incrustadas dentro del interior de una figura (ej. vértices)
                    if not es_pal and any(_rect_en(arect, fr, -2.0) for fr in figs_pag):
                        continue
                    eventos.append((columna(arect.x0, arect.x1), arect.y0, "alt", (letra, arect, es_pal)))

            for r in figs_pag:
                eventos.append((columna(r.x0, r.x1), r.y0, "fig", r))

            dos_columnas = any(e[0] == 1 for e in eventos if e[2] in ("preg", "cand_preg")) and any(e[0] == 0 for e in eventos if e[2] in ("preg", "cand_preg"))
            prioridad = {"ctx": 0, "preg": 1, "cand_preg": 1, "alt": 2, "fig": 3}
            eventos.sort(key=lambda e: ((e[0] if dos_columnas else 0), e[1], prioridad[e[2]]))

            cur_slice: Optional[Dict[str, Any]] = None
            if actual is not None:
                cur_slice = {"page": pidx, "alts": [], "figs": []}
                slices_preg.setdefault(actual, []).append(cur_slice)

            for _col, _y, tipo, dato in eventos:
                if tipo == "cand_preg":
                    if dato != ultimo_q + 1:
                        continue
                    tipo = "preg"
                if tipo == "ctx":
                    ctx_actual, actual, cur_slice = dato, None, None
                elif tipo == "preg":
                    actual, ctx_actual = dato, None
                    ultimo_q = max(ultimo_q, dato)
                    cur_slice = {"page": pidx, "alts": [], "figs": []}
                    slices_preg.setdefault(actual, []).append(cur_slice)
                elif tipo == "alt" and cur_slice is not None:
                    cur_slice["alts"].append(dato)
                elif tipo == "fig":
                    if actual is not None and cur_slice is not None:
                        cur_slice["figs"].append(dato)
                    elif ctx_actual:
                        slices_ctx.append((pidx, list(ctx_actual), dato))

        # Fase 2: guarda figuras de contexto (siempre al enunciado) y figuras por pregunta (enunciado vs opciones)
        conteo_por_preg: Dict[int, int] = {}

        def _guardar_recorte(qnums: List[int], pidx: int, rect_recorte) -> List[Tuple[int, str]]:
            page = doc[pidx]
            clip = _ajustar_clip(page, rect_recorte, bloques_por_pag[pidx])
            pix = page.get_pixmap(clip=clip, dpi=160)
            os.makedirs(dir_salida, exist_ok=True)
            guardadas: List[Tuple[int, str]] = []
            for qnum in qnums:
                n_actual = conteo_por_preg.get(qnum, 0)
                if n_actual >= MAX_FIGURAS_POR_PREGUNTA:
                    continue
                nombre = f"q{qnum}_{n_actual + 1}.png"
                pix.save(os.path.join(dir_salida, nombre))
                conteo_por_preg[qnum] = n_actual + 1
                guardadas.append((qnum, nombre))
            return guardadas

        for pidx, dests, rect in slices_ctx:
            for qnum, nombre in _guardar_recorte(dests, pidx, rect):
                resultado.setdefault(qnum, {"figuras": [], "figurasAlternativas": {}})["figuras"].append(nombre)

        for qnum in sorted(slices_preg.keys()):
            q_slices = slices_preg[qnum]
            tiene_pal = any(es_pal for sl in q_slices for _, _, es_pal in sl["alts"])
            letras_cand = {lt for sl in q_slices for lt, _, es_pal in sl["alts"] if tiene_pal == es_pal}
            alts_validas = tiene_pal or ("A" in letras_cand and "B" in letras_cand)

            alt_previa: Optional[str] = None
            pendientes_por_alt: Dict[Tuple[int, str], List[Any]] = {}

            for sl in q_slices:
                pidx = sl["page"]
                alts_p = [
                    (lt, r) for lt, r, es_pal in sl["alts"]
                    if alts_validas and (es_pal if tiene_pal else True)
                ]
                if sl["figs"]:
                    asignaciones = _asignar_figuras_de_pregunta(sl["figs"], alts_p, bloques_por_pag[pidx], alt_previa)
                    for destino_alt, frect in asignaciones:
                        if destino_alt is None:
                            for _, nombre in _guardar_recorte([qnum], pidx, frect):
                                resultado.setdefault(qnum, {"figuras": [], "figurasAlternativas": {}})["figuras"].append(nombre)
                        else:
                            pendientes_por_alt.setdefault((pidx, destino_alt), []).append(frect)
                if alts_p:
                    alt_previa = sorted(alts_p, key=lambda it: (it[1].y0, it[1].x0))[-1][0]

            # Consolida los trazos asignados a la misma alternativa en un recorte limpio por letra
            for letra in LETRAS:
                for (pidx, lt), rects_lt in sorted(pendientes_por_alt.items()):
                    if lt != letra:
                        continue
                    rect_lt = fitz.Rect(rects_lt[0])
                    for rx in rects_lt[1:]:
                        rect_lt = rect_lt | rx
                    for _, nombre in _guardar_recorte([qnum], pidx, rect_lt):
                        entry = resultado.setdefault(qnum, {"figuras": [], "figurasAlternativas": {}})
                        entry["figurasAlternativas"].setdefault(letra, nombre)

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

    # Figuras (gráficos vectoriales o imágenes) recortadas por enunciado y alternativa
    total_figuras = 0
    if dir_figuras:
        try:
            por_pregunta = extraer_figuras(ruta_preguntas, [q["numero"] for q in preguntas], dir_figuras)
        except Exception:
            por_pregunta = {}
        for q in preguntas:
            info = por_pregunta.get(q["numero"])
            if not info:
                continue
            figs_enun = info.get("figuras") or []
            figs_alt = info.get("figurasAlternativas") or {}
            if figs_enun:
                q["figuras"] = figs_enun
                total_figuras += len(figs_enun)
            if figs_alt:
                q["figurasAlternativas"] = figs_alt
                total_figuras += len(figs_alt)
            for l in list(q["alternativas"].keys()):
                if not q["alternativas"][l].strip():
                    q["alternativas"][l] = f"(Ver imagen: Alternativa {l})"

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
