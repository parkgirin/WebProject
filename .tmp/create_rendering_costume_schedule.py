from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "plans" / "RENDERING_COSTUME_WORK_SCHEDULE.docx"

FONT = "Malgun Gothic"
NAVY = "203864"
PALE_BLUE = "EAF2F8"
PALE_GRAY = "F5F7F9"
BORDER = "D9D9D9"
TEXT = "202124"
MUTED = "5B6573"


def set_run_font(run, size=None, bold=None, color=TEXT):
    run.font.name = FONT
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), FONT)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), FONT)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), FONT)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=110, start=120, bottom=110, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=BORDER, size="6"):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        element = borders.find(tag)
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_cell_width(cell, inches):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(inches * 1440)))
    tc_w.set(qn("w:type"), "dxa")


def format_paragraph(paragraph, size=10.5, color=TEXT, bold=False, align=None, before=0, after=4, line=1.18):
    if align is not None:
        paragraph.alignment = align
    pf = paragraph.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    for run in paragraph.runs:
        set_run_font(run, size=size, bold=bold, color=color)


def add_body(doc, text, bold_lead=None, after=6):
    p = doc.add_paragraph()
    if bold_lead and text.startswith(bold_lead):
        lead = p.add_run(bold_lead)
        set_run_font(lead, size=10.5, bold=True)
        rest = p.add_run(text[len(bold_lead):])
        set_run_font(rest, size=10.5)
    else:
        run = p.add_run(text)
        set_run_font(run, size=10.5)
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.22
    return p


def add_bullet(doc, text, level=0):
    p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
    p.paragraph_format.left_indent = Inches(0.22 + 0.24 * level)
    p.paragraph_format.first_line_indent = Inches(-0.15)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.15
    r = p.add_run(text)
    set_run_font(r, size=10.2)
    return p


def add_heading(doc, text, level=1):
    p = doc.add_paragraph(text, style=f"Heading {level}")
    p.paragraph_format.keep_with_next = True
    return p


def style_table(table, widths, header=True, font_size=9.2, alignments=None):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    for r_idx, row in enumerate(table.rows):
        if header and r_idx == 0:
            set_repeat_table_header(row)
        for c_idx, cell in enumerate(row.cells):
            set_cell_width(cell, widths[c_idx])
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if header and r_idx == 0:
                set_cell_shading(cell, NAVY)
            elif r_idx % 2 == 0:
                set_cell_shading(cell, PALE_BLUE)
            else:
                set_cell_shading(cell, "FFFFFF")
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.line_spacing = 1.12
                if alignments:
                    paragraph.alignment = alignments[c_idx]
                for run in paragraph.runs:
                    set_run_font(
                        run,
                        size=font_size,
                        bold=(header and r_idx == 0),
                        color="FFFFFF" if header and r_idx == 0 else TEXT,
                    )


def add_table_caption(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_run_font(r, size=9.5, bold=True, color=MUTED)


doc = Document()
section = doc.sections[0]
section.orientation = WD_ORIENT.PORTRAIT
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.68)
section.bottom_margin = Inches(0.65)
section.left_margin = Inches(0.72)
section.right_margin = Inches(0.72)

styles = doc.styles
styles["Normal"].font.name = FONT
styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
styles["Normal"].font.size = Pt(10.5)
styles["Title"].font.name = FONT
styles["Title"]._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
styles["Title"].font.size = Pt(23)
styles["Title"].font.bold = True
styles["Title"].font.color.rgb = RGBColor(0, 0, 0)
for level, size in ((1, 15), (2, 12.5)):
    st = styles[f"Heading {level}"]
    st.font.name = FONT
    st._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = RGBColor(0, 0, 0)
    st.paragraph_format.space_before = Pt(10 if level == 1 else 7)
    st.paragraph_format.space_after = Pt(5)

title = doc.add_paragraph(style="Title")
title.paragraph_format.space_after = Pt(6)
title.add_run("렌더링 및 의상 기능 작업 일정")

subtitle = doc.add_paragraph()
subtitle.paragraph_format.space_after = Pt(11)
r = subtitle.add_run("게임 리소스 출력 최소 기준 달성을 위한 6주 실행 계획")
set_run_font(r, size=12, bold=True, color=MUTED)

meta = doc.add_table(rows=3, cols=4)
meta_data = [
    ("기준일", "2026년 11월 24일", "실행 기간", "2026년 11월 30일 - 2027년 1월 8일"),
    ("일정 기준", "핵심 구현 1명 순차 진행", "검증 방식", "자동 테스트 + 실제 PNG SVG JSON 파일 비교"),
    ("현재 위치", "M2 최종 검증 진행 중", "완료 목표", "M3 의상 셸 M4 병합 SVG M5 통합 검증"),
]
for i, row_data in enumerate(meta_data):
    for j, value in enumerate(row_data):
        meta.rows[i].cells[j].text = value
style_table(meta, [0.78, 2.1, 0.85, 2.93], header=False, font_size=9.1,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT])
for row in meta.rows:
    for idx in (0, 2):
        set_cell_shading(row.cells[idx], PALE_GRAY)
        for run in row.cells[idx].paragraphs[0].runs:
            set_run_font(run, size=9.1, bold=True, color=TEXT)

add_heading(doc, "1 일정 목표", 1)
add_body(doc, "이번 일정은 기존 애니메이션 출력 경로를 유지하면서 재사용 가능한 튜브 렌더링 계산, 의상용 튜브 셸, 출력 그룹별 병합 SVG와 교차 경고를 순서대로 완성하는 계획이다. 핵심 결과는 소매가 포즈와 월드 회전을 안정적으로 따라가고, 몸통과 의상이 지정된 출력 그룹별로 내부선 없이 열린 SVG로 출력되는 것이다.")
add_body(doc, "완료 판단은 기능 구현 자체가 아니라 편집 화면, 애니메이션 재생, PNG, SVG, 스프라이트 시트와 프로젝트 재불러오기에서 같은 결과가 반복되는지로 결정한다.")

add_heading(doc, "2 전체 일정", 1)
add_table_caption(doc, "주차별 실행 일정")
schedule = doc.add_table(rows=1, cols=6)
headers = ["주차", "기간", "핵심 작업", "주요 산출물", "완료 기준", "상태"]
for i, h in enumerate(headers):
    schedule.rows[0].cells[i].text = h
rows = [
    ("1주", "11월 30일\n- 12월 4일", "출력 기준 고정\n튜브 회귀 기반", "M2 검증 기록\nTubeSection 계약", "외부 재생 표본 통과\n기존 팔다리 픽셀 차이 없음", "진입"),
    ("2주", "12월 7일\n- 12월 11일", "TubeSection 분리\n카메라 대응 단면", "공통 튜브 계산\n회귀 테스트", "정면 측면 45도\n원근 및 월드 회전 통과", "계획"),
    ("3주", "12월 14일\n- 12월 18일", "TubeShell 모델\n소매 기준 구현", "셸 데이터 구조\n소매 렌더링", "양 끝 반지름과 오프셋\n포즈 추종 확인", "계획"),
    ("4주", "12월 21일\n- 12월 25일", "의상 편집 연결\n저장 보간 출력", "속성 UI\n프로젝트 왕복", "PNG SVG 애니메이션에서\n같은 의상 결과", "계획"),
    ("5주", "12월 28일\n- 2027년 1월 1일", "출력 그룹 병합\n내부선 제거", "병합 SVG\n그룹 정렬 규칙", "편집 가이드 제외\n그룹 경계와 순서 유지", "계획"),
    ("6주", "1월 4일\n- 1월 8일", "교차 경고\n통합 검증", "실제 에셋 패키지\n완료 보고", "M3 M4 M5 인수 기준 통과\n비교차 출력 안정", "완료 목표"),
]
for row in rows:
    cells = schedule.add_row().cells
    for i, value in enumerate(row):
        cells[i].text = value
style_table(schedule, [0.45, 0.82, 1.24, 1.31, 2.0, 0.64], header=True, font_size=8.2,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT,
                        WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER])

add_body(doc, "12월 25일과 2027년 1월 1일은 구현 의존 작업을 배치하지 않고 문서 정리, 회귀 확인과 예비 시간으로 사용한다. 앞 단계가 완료 기준을 통과하지 못하면 다음 단계의 데이터 구조 변경을 시작하지 않는다.", bold_lead="12월 25일과 2027년 1월 1일")

doc.add_page_break()

add_heading(doc, "3 단계별 작업 내용", 1)

phases = [
    ("1주차 출력 기준과 회귀 입력 확정", [
        "남아 있는 M2 검증인 외부 런타임 재생, 루트 이동 분리와 핑퐁 표본을 마감한다.",
        "정면, 측면, 45도, 팔 내림, 다리 교차, 월드 회전과 투명 합성 도형을 회귀 입력으로 고정한다.",
        "기존 팔다리 카메라 대응 면의 입력과 출력 경계를 TubeSection 계약으로 문서화한다.",
        "PNG 프레임, 스프라이트 시트 셀과 SVG의 비교 방법을 자동화 가능한 단위로 나눈다.",
    ], "M2가 닫히고 TubeSection 분리 전후를 비교할 기준 출력이 보관된다."),
    ("2주차 재사용 가능한 튜브 렌더링", [
        "팔다리 전용 계산에서 카메라 방향 단면, 길이 방향 연결과 투영 좌표 계산을 분리한다.",
        "기존 관절 반지름, 단면 프로필, 원근 강도와 카메라 회전 입력을 그대로 수용한다.",
        "정면, 좌우 측면, 45도와 애니메이션 프레임에서 기존 결과가 바뀌지 않는지 회귀 테스트를 추가한다.",
        "편집 SVG와 PNG 출력이 같은 TubeSection 결과를 사용하는지 확인한다.",
    ], "기존 에셋에 의도하지 않은 시각 차이가 없고 공통 튜브 계산을 의상 셸에서 호출할 수 있다."),
    ("3주차 의상용 튜브 셸과 소매", [
        "TubeShell에 부모 튜브 참조, 시작과 끝 반지름, 길이 오프셋, 색상, 표시 상태와 출력 그룹을 정의한다.",
        "소매 하나를 기준 구현으로 만들고 팔의 양 끝 단면을 감싸는 외곽을 생성한다.",
        "팔 굽힘, 깊이 회전, 좌우 방향 전환과 체형 반지름 차이에서 셸이 뒤집히거나 신체 안으로 붕괴하지 않는지 검사한다.",
        "잘못된 부모 참조, 음수 두께와 퇴화 길이를 저장 전 검증에서 차단한다.",
    ], "소매가 부모 팔의 포즈와 월드 회전을 추종하고 단독 PNG와 SVG 출력에서도 같은 외곽을 유지한다."),
    ("4주차 의상 편집과 파일 왕복", [
        "속성 패널에서 셸 반지름, 길이 오프셋, 색상과 출력 그룹을 편집한다.",
        "프로젝트 JSON 저장과 불러오기, 실행 취소와 다시 실행의 소유 경계를 연결한다.",
        "포즈 보간 중에는 셸이 부모 튜브의 파생 결과를 따르며 별도 위치 키를 만들지 않는다.",
        "편집 화면, 재생, PNG와 SVG 프레임 ZIP, 스프라이트 시트에서 결과를 비교한다.",
    ], "저장과 재불러오기 전후의 셸 값과 렌더 결과가 같고 기존 파일은 기본값으로 안전하게 마이그레이션된다."),
]

for title_text, bullets, done in phases:
    add_heading(doc, title_text, 2)
    for b in bullets:
        add_bullet(doc, b)
    add_body(doc, "완료 기준: " + done, bold_lead="완료 기준:", after=7)

doc.add_page_break()

phases2 = [
    ("5주차 출력 그룹별 병합 SVG", [
        "투영된 원, 튜브, 의상 셸과 자유 도형을 출력 그룹별로 수집한다.",
        "같은 그룹의 채움 경계를 boolean union으로 병합하고 내부선을 제거한다.",
        "그룹 간 경계, 카메라 거리와 레이어 순서는 유지하며 관절 가이드, 축과 선택 핸들은 병합 대상에서 제외한다.",
        "빈 그룹, 끊어진 섬, 구멍이 있는 경계와 동일 깊이 동률을 결정적으로 정렬한다.",
    ], "몸통, 팔과 소매가 지정된 그룹 단위로 독립 SVG에 열리고 같은 입력을 반복 출력해도 경로와 순서가 변하지 않는다."),
    ("6주차 교차 경고와 통합 검증", [
        "부분 교차, 자기 교차와 비교차 포즈를 구분해 경고 목록과 캔버스 표시로 연결한다.",
        "첫 범위에서는 자동 깊이 절단을 구현하지 않고 문제가 있는 요소와 프레임을 재현 가능하게 식별한다.",
        "실제 게임 에셋 한 개를 PNG, JSON, 개별 SVG, 병합 SVG와 프로젝트 파일로 출력한다.",
        "외부 뷰어에서 FPS, 루프, 피벗과 루트 이동을 재생하고 프로젝트 재불러오기까지 확인한다.",
    ], "M3부터 M5까지의 인수 기준을 통과하고 알려진 제한과 후속 항목이 완료 보고에 기록된다."),
]
for title_text, bullets, done in phases2:
    add_heading(doc, title_text, 2)
    for b in bullets:
        add_bullet(doc, b)
    add_body(doc, "완료 기준: " + done, bold_lead="완료 기준:", after=7)

add_heading(doc, "4 검증 매트릭스", 1)
add_table_caption(doc, "기능별 필수 검증")
matrix = doc.add_table(rows=1, cols=5)
for i, h in enumerate(["검증 대상", "자동 테스트", "실제 출력", "비교 조건", "통과 기준"]):
    matrix.rows[0].cells[i].text = h
matrix_rows = [
    ("TubeSection", "단면 좌표와 정렬", "기존 PNG SVG", "분리 전후", "의도하지 않은 픽셀과 경로 차이 없음"),
    ("TubeShell", "참조와 유효성", "소매 PNG SVG", "정면 측면 45도", "뒤집힘 붕괴 잘림 없음"),
    ("애니메이션", "보간과 baked 순서", "프레임 ZIP 시트", "루프 핑퐁 월드 회전", "프레임 순서와 피벗 일치"),
    ("저장", "v3 왕복과 마이그레이션", "프로젝트 JSON", "저장 전후", "셸 값과 화면 결과 동일"),
    ("병합 SVG", "그룹과 순서", "독립 SVG", "반복 출력", "내부선 없음 경로 순서 결정적"),
    ("교차 경고", "교차 분류", "경고 포함 샘플", "교차 비교차", "오탐과 누락이 승인 범위 내"),
]
for row in matrix_rows:
    cells = matrix.add_row().cells
    for i, value in enumerate(row):
        cells[i].text = value
style_table(matrix, [1.02, 1.30, 1.20, 1.25, 2.0], header=True, font_size=8.5,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT,
                        WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT])

add_heading(doc, "5 주간 운영 규칙", 1)
for bullet in [
    "월요일에는 해당 주의 회귀 입력과 완료 기준을 고정하고 데이터 구조 변경 범위를 확정한다.",
    "수요일에는 중간 렌더를 PNG와 SVG로 남겨 편집 화면과 출력 경로의 차이를 조기에 확인한다.",
    "금요일에는 자동 테스트와 프로덕션 빌드뿐 아니라 실제 파일 열기와 재불러오기를 수행한다.",
    "완료 기준을 충족하지 못한 작업은 다음 주의 첫 작업으로 이월하고 후속 단계의 대규모 변경을 섞지 않는다.",
]:
    add_bullet(doc, bullet)

doc.add_page_break()

add_heading(doc, "6 위험과 대응", 1)
add_table_caption(doc, "일정에 영향을 주는 주요 위험")
risks = doc.add_table(rows=1, cols=4)
for i, h in enumerate(["위험", "징후", "대응", "일정 판단"]):
    risks.rows[0].cells[i].text = h
risk_rows = [
    ("튜브 분리 회귀", "기존 팔 다리 외곽 변화", "공통 계산의 입력을 기존 값과 동일하게 고정하고 픽셀 비교", "차이가 남으면 3주차 진입 보류"),
    ("셸 뒤집힘", "깊이 회전에서 단면 순서 역전", "방향 기준과 퇴화 처리 규칙을 먼저 고정", "단일 소매 안정화 전 UI 확장 금지"),
    ("SVG 병합 복잡도", "구멍 또는 끊어진 섬 손실", "첫 범위를 단색 채움과 그룹 단위 union으로 제한", "복잡 도형은 후속 백로그로 분리"),
    ("교차 판정 오탐", "정상 앞뒤 가림도 경고", "깊이와 렌더 순서를 정상 가림 예외로 사용", "경고는 차단이 아닌 안내로 출시"),
    ("휴일로 인한 작업일 감소", "주간 검토 시간 부족", "12월 25일과 1월 1일을 예비일로 간주하고 의존 작업 배제", "핵심 구현은 전날까지 완료"),
]
for row in risk_rows:
    cells = risks.add_row().cells
    for i, value in enumerate(row):
        cells[i].text = value
style_table(risks, [1.22, 1.55, 2.63, 1.37], header=True, font_size=8.6,
            alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 4)

add_heading(doc, "7 최종 인수 기준", 1)
for bullet in [
    "기존 리그의 정면, 측면, 45도와 애니메이션 출력이 TubeSection 분리 전 기준과 일치한다.",
    "소매 TubeShell이 부모 팔의 포즈, 체형, 월드 회전과 애니메이션을 안정적으로 따른다.",
    "의상 값이 프로젝트 저장, 재불러오기와 구버전 마이그레이션에서 손실되지 않는다.",
    "동일 출력 그룹의 몸통, 팔과 소매가 내부선 없는 SVG 경계로 병합된다.",
    "편집 화면, 재생, PNG, SVG, 스프라이트 시트와 외부 런타임의 피벗 및 프레임 순서가 일치한다.",
    "교차 문제가 요소와 프레임 단위로 경고되며 비교차 포즈의 외곽선이 누락되지 않는다.",
    "자동 테스트와 프로덕션 빌드가 통과하고 실제 게임 에셋 패키지의 재불러오기가 성공한다.",
]:
    add_bullet(doc, bullet)

add_body(doc, "이 기준을 모두 충족하면 리소스 출력 최소 기능의 M3, M4와 M5를 완료로 전환한다. 여러 겹 의상, 임의 메시 의상, 정밀 깊이 절단과 카메라 키프레임은 다음 작업 범위로 유지한다.", after=0)

for paragraph in doc.paragraphs:
    for run in paragraph.runs:
        if run.font.name is None:
            set_run_font(run, size=10.5)

doc.core_properties.title = "렌더링 및 의상 기능 작업 일정"
doc.core_properties.subject = "게임 리소스 출력 최소 기준 달성을 위한 6주 실행 계획"
doc.core_properties.author = ""
doc.core_properties.keywords = "렌더링, 의상, TubeSection, TubeShell, SVG, 작업 일정"

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUTPUT)
print(OUTPUT)
