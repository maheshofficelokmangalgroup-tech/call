"""Reading a sheet safely: any encoding, any delimiter, rows one at a time - and a file that is not what it says is refused."""

from __future__ import annotations

import io
import struct
import zipfile

import pytest
from openpyxl import Workbook

from app.core.config import reset_settings_cache
from app.services.import_files import SheetError, detect_encoding, open_sheet, sniff_delimiter


def write(tmp_path, name: str, content: bytes):
    path = tmp_path / name
    path.write_bytes(content)
    return path


def read_all(path, file_type):
    with open_sheet(path, file_type) as sheet:
        return sheet.headers, list(sheet.rows())


# --------------------------------------------------------------------------------------------------------------- CSV
@pytest.mark.parametrize(
    "encoding,bom",
    [("utf-8", b""), ("utf-8", b"\xef\xbb\xbf"), ("utf-16", b""), ("cp1252", b"")],
    ids=["utf8", "utf8-with-bom (Excel)", "utf16", "windows-1252 (Excel on Windows)"],
)
def test_text_in_the_usual_encodings_is_read_correctly(tmp_path, encoding, bom):
    text = "Name,Mobile,City\nJosé Müller,9876500001,Zürich\nÅsa,9876500002,Köln\n"
    body = text.encode(encoding) if encoding == "utf-16" else bom + text.encode(encoding)
    headers, rows = read_all(write(tmp_path, "a.csv", body), "csv")
    assert headers == ["Name", "Mobile", "City"]
    assert [cells[0] for _, cells in rows] == ["José Müller", "Åsa"]


def test_a_devanagari_name_in_utf8_survives(tmp_path):
    headers, rows = read_all(write(tmp_path, "m.csv", "Name,Mobile\nमहेश शेळके,9876500001\n".encode("utf-8")), "csv")
    assert rows == [(2, ["महेश शेळके", "9876500001"])]


@pytest.mark.parametrize("delimiter", [",", ";", "\t", "|"])
def test_the_delimiter_is_found(tmp_path, delimiter):
    text = delimiter.join(["Name", "Mobile", "City"]) + "\n" + delimiter.join(["Ann", "9876500001", "Pune"]) + "\n" + delimiter.join(["Bob", "9876500002", "Nagpur"]) + "\n"
    headers, rows = read_all(write(tmp_path, "d.csv", text.encode()), "csv")
    assert headers == ["Name", "Mobile", "City"] and [c[1] for _, c in rows] == ["9876500001", "9876500002"]


def test_row_numbers_are_the_ones_a_spreadsheet_shows_and_blank_rows_are_skipped(tmp_path):
    body = b"Name,Mobile\nAnn,9876500001\n\n  ,  \nBob,9876500002\n"
    _, rows = read_all(write(tmp_path, "b.csv", body), "csv")
    assert [(n, c[0]) for n, c in rows] == [(2, "Ann"), (5, "Bob")]


def test_quoted_cells_with_newlines_and_delimiters_stay_one_cell(tmp_path):
    body = b'Name,Mobile,Notes\n"Ann, the first",9876500001,"line one\nline two"\n'
    _, rows = read_all(write(tmp_path, "q.csv", body), "csv")
    assert rows[0][1] == ["Ann, the first", "9876500001", "line one\nline two"]


def test_a_file_with_only_a_header_has_no_rows_and_an_empty_file_is_refused(tmp_path):
    headers, rows = read_all(write(tmp_path, "h.csv", b"Name,Mobile\n"), "csv")
    assert headers == ["Name", "Mobile"] and rows == []
    with pytest.raises(SheetError) as raised:
        open_sheet(write(tmp_path, "e.csv", b"\n\n  \n"), "csv")
    assert raised.value.code == "empty_file"


def test_binary_data_renamed_to_csv_is_refused(tmp_path):
    for content in (b"MZ\x90\x00\x03\x00\x00\x00" + bytes(range(256)) * 20, b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + bytes(500), b"%PDF-1.7\n\x00\x00\x00" + bytes(300)):
        with pytest.raises(SheetError) as raised:
            open_sheet(write(tmp_path, "evil.csv", content), "csv")
        assert "binary" in raised.value.message


def test_a_cell_larger_than_the_csv_limit_is_a_clear_error_not_a_crash(tmp_path):
    body = b"Name,Mobile\n" + b'"' + b"x" * (200 * 1024) + b'",9876500001\n'
    with open_sheet(write(tmp_path, "big.csv", body), "csv") as sheet:
        with pytest.raises(SheetError) as raised:
            list(sheet.rows())
    assert "could not be read" in raised.value.message


def test_too_many_columns_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("MAX_IMPORT_COLUMNS", "5")
    reset_settings_cache()
    try:
        with pytest.raises(SheetError) as raised:
            open_sheet(write(tmp_path, "w.csv", b"a,b,c,d,e,f,g\n1,2,3,4,5,6,7\n"), "csv")
        assert "more than 5 columns" in raised.value.message
    finally:
        monkeypatch.undo()
        reset_settings_cache()


def test_progress_follows_the_position_in_the_file(tmp_path):
    body = b"Name,Mobile\n" + b"".join(f"P{i},{9000000000 + i}\n".encode() for i in range(2000))
    with open_sheet(write(tmp_path, "p.csv", body), "csv") as sheet:
        seen = []
        for number, _ in sheet.rows():
            if number % 500 == 0:
                seen.append(sheet.progress())
    assert seen == sorted(seen) and 0 < seen[0] < seen[-1] <= 99


def test_the_delimiter_sniffer_never_fails():
    assert sniff_delimiter("") == ","
    assert sniff_delimiter("only one column\nvalue\n") == ","
    assert detect_encoding(b"plain ascii") == "utf-8"


# -------------------------------------------------------------------------------------------------------------- XLSX
def workbook(rows) -> bytes:
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_the_first_sheet_of_a_workbook_is_read_with_numbers_as_numbers(tmp_path):
    headers, rows = read_all(write(tmp_path, "w.xlsx", workbook([["Name", "Mobile", "City"], ["Ann", 9876500001, "Pune"], [None, None, None], ["Bob", "9876500002", "Nagpur"]])), "xlsx")
    assert headers == ["Name", "Mobile", "City"]
    assert rows == [(2, ["Ann", 9876500001, "Pune"]), (4, ["Bob", "9876500002", "Nagpur"])]


def test_formulas_are_never_evaluated_only_the_stored_value_is_read(tmp_path):
    headers, rows = read_all(write(tmp_path, "f.xlsx", workbook([["Name", "Mobile"], ["=HYPERLINK(\"http://evil\",\"x\")", "9876500001"], ["=1+1", "9876500002"]])), "xlsx")
    assert all(not isinstance(cells[0], (int, float)) for _, cells in rows)  # (a formula has no stored value: openpyxl gives None or the text)


def test_a_file_that_is_not_a_zip_is_refused_as_xlsx(tmp_path):
    with pytest.raises(SheetError) as raised:
        open_sheet(write(tmp_path, "fake.xlsx", b"Name,Mobile\nAnn,9876500001\n"), "xlsx")
    assert "not a valid Excel" in raised.value.message


def test_a_zip_that_is_not_a_workbook_is_refused(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "hello")
    with pytest.raises(SheetError) as raised:
        open_sheet(write(tmp_path, "z.xlsx", buf.getvalue()), "xlsx")
    assert "not an Excel workbook" in raised.value.message


def test_a_workbook_with_macros_is_refused(tmp_path):
    source = zipfile.ZipFile(io.BytesIO(workbook([["Name", "Mobile"], ["A", 9876500001]])))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in source.namelist():
            z.writestr(name, source.read(name))
        z.writestr("xl/vbaProject.bin", b"\x00macro")
    with pytest.raises(SheetError) as raised:
        open_sheet(write(tmp_path, "m.xlsx", buf.getvalue()), "xlsx")
    assert "macros" in raised.value.message


def test_a_zip_bomb_is_refused_before_anything_is_unpacked(tmp_path, monkeypatch):
    monkeypatch.setenv("MAX_IMPORT_XLSX_UNPACKED_MB", "50")
    reset_settings_cache()
    try:
        source = zipfile.ZipFile(io.BytesIO(workbook([["Name", "Mobile"], ["A", 9876500001]])))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name in source.namelist():
                z.writestr(name, source.read(name))
            z.writestr("xl/worksheets/bomb.xml", b"0" * (200 * 1024 * 1024))  # 200 MB of zeros: a few hundred KB packed
        assert len(buf.getvalue()) < 1024 * 1024
        with pytest.raises(SheetError) as raised:
            open_sheet(write(tmp_path, "bomb.xlsx", buf.getvalue()), "xlsx")
        assert "unpacks to more than 50 MB" in raised.value.message
    finally:
        monkeypatch.undo()
        reset_settings_cache()


def test_an_unusually_compressed_entry_is_refused_even_under_the_size_limit(tmp_path):
    source = zipfile.ZipFile(io.BytesIO(workbook([["Name", "Mobile"], ["A", 9876500001]])))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in source.namelist():
            z.writestr(name, source.read(name))
        z.writestr("xl/media/pad.bin", b"\x00" * (60 * 1024 * 1024))  # 60 MB -> about 60 KB: a ratio of ~1000
    with pytest.raises(SheetError) as raised:
        open_sheet(write(tmp_path, "ratio.xlsx", buf.getvalue()), "xlsx")
    assert "compressed far more" in raised.value.message


def test_a_zip_with_thousands_of_entries_is_refused(tmp_path):
    source = zipfile.ZipFile(io.BytesIO(workbook([["Name", "Mobile"], ["A", 9876500001]])))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in source.namelist():
            z.writestr(name, source.read(name))
        for i in range(5200):
            z.writestr(f"xl/extra/{i}.xml", b"<a/>")
    with pytest.raises(SheetError) as raised:
        open_sheet(write(tmp_path, "many.xlsx", buf.getvalue()), "xlsx")
    assert "unusual structure" in raised.value.message


def test_an_encrypted_entry_is_refused(tmp_path):
    source = zipfile.ZipFile(io.BytesIO(workbook([["Name", "Mobile"], ["A", 9876500001]])))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in source.namelist():
            z.writestr(name, source.read(name))
    data = bytearray(buf.getvalue())
    # set the "encrypted" bit (bit 0 of the general purpose flags) in the central directory entry of every file
    index = 0
    while (index := data.find(b"PK\x01\x02", index)) != -1:
        flags = struct.unpack_from("<H", data, index + 8)[0]
        struct.pack_into("<H", data, index + 8, flags | 0x1)
        index += 4
    with pytest.raises(SheetError) as raised:
        open_sheet(write(tmp_path, "locked.xlsx", bytes(data)), "xlsx")
    assert "password" in raised.value.message


def test_an_xml_entity_bomb_inside_a_workbook_is_not_expanded(tmp_path):
    source = zipfile.ZipFile(io.BytesIO(workbook([["Name", "Mobile"], ["A", 9876500001]])))
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">'
        b'<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>'
        b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&lol3;</t></is></c></row></sheetData></worksheet>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in source.namelist():
            z.writestr(name, bomb if name == "xl/worksheets/sheet1.xml" else source.read(name))
    path = write(tmp_path, "entities.xlsx", buf.getvalue())
    try:
        headers, rows = read_all(path, "xlsx")
        text = "".join(str(c) for _, cells in rows for c in cells) + "".join(headers)
        assert "lollollol" not in text  # never expanded (a refusal is also fine)
    except SheetError:
        pass
