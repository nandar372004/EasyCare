from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


output = Path(__file__).with_name("easycare-staging-test-credential.pdf")
page_width, page_height = letter
pdf = canvas.Canvas(str(output), pagesize=letter, pageCompression=1)
pdf.setTitle("EasyCare Staging Test Only - Not a Medical Credential")
pdf.setAuthor("EasyCare Staging Workflow Test")
pdf.setSubject("Synthetic document for Staging private credential workflow testing only")

navy = colors.HexColor("#15334B")
blue = colors.HexColor("#167FA5")
red = colors.HexColor("#9E2F36")
light = colors.HexColor("#F2F8FB")
muted = colors.HexColor("#506779")

pdf.setFillColor(light)
pdf.roundRect(48, 48, page_width - 96, page_height - 96, 18, fill=1, stroke=0)

pdf.setFillColor(blue)
pdf.roundRect(76, page_height - 165, page_width - 152, 70, 12, fill=1, stroke=0)
pdf.setFillColor(colors.white)
pdf.setFont("Helvetica-Bold", 17)
pdf.drawCentredString(page_width / 2, page_height - 124, "EASYCARE STAGING TEST DOCUMENT")

pdf.setFillColor(red)
pdf.setFont("Helvetica-Bold", 22)
pdf.drawCentredString(page_width / 2, page_height - 225, "STAGING TEST ONLY")
pdf.setFont("Helvetica-Bold", 18)
pdf.drawCentredString(page_width / 2, page_height - 255, "NOT A REAL MEDICAL CREDENTIAL")

pdf.setStrokeColor(colors.HexColor("#D8E5EC"))
pdf.setLineWidth(1)
pdf.line(100, page_height - 285, page_width - 100, page_height - 285)

paragraphs = [
    "This synthetic document exists only to test the private credential upload, review, and approval workflow in the EasyCare Staging environment.",
    "It does not identify a real person or assert a medical license, professional registration, qualification, training, specialty, or clinical authority.",
    "No real credential is represented or claimed. It must never be used as evidence of professional eligibility outside this isolated workflow test.",
]

pdf.setFillColor(navy)
pdf.setFont("Helvetica", 12)
y = page_height - 330
max_width = page_width - 200
for paragraph in paragraphs:
    words = paragraph.split()
    lines = []
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if stringWidth(candidate, "Helvetica", 12) > max_width and line:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    for text_line in lines:
        pdf.drawString(100, y, text_line)
        y -= 19
    y -= 17

pdf.setFillColor(colors.white)
pdf.roundRect(100, 130, page_width - 200, 82, 10, fill=1, stroke=0)
pdf.setFillColor(red)
pdf.setFont("Helvetica-Bold", 12)
pdf.drawCentredString(page_width / 2, 180, "TEST WORKFLOW ONLY")
pdf.setFillColor(muted)
pdf.setFont("Helvetica", 10)
pdf.drawCentredString(page_width / 2, 159, "Synthetic placeholder. No real license number or issuer is present.")
pdf.drawCentredString(page_width / 2, 143, "Approval of this file must not be interpreted as real-world credential verification.")

pdf.setFillColor(muted)
pdf.setFont("Helvetica", 9)
pdf.drawCentredString(page_width / 2, 84, "EasyCare Staging - synthetic workflow validation")

pdf.showPage()
pdf.save()
print(output)
