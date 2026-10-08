// Bridges pdfmake-rtl 2.x (instance-based) and CommonJS.

let pdfmakeInstance = null;

async function generatePDFBuffer(fonts, docDefinition) {
    if (!pdfmakeInstance) {
        const module = await import('pdfmake-rtl');
        pdfmakeInstance = module.default || module;
    }

    pdfmakeInstance.setFonts(fonts);
    return await pdfmakeInstance.createPdf(docDefinition).getBuffer();
}

module.exports = { generatePDFBuffer };
