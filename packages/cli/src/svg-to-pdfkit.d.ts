declare module "svg-to-pdfkit" {
  import type PDFDocument from "pdfkit";
  interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    fontCallback?: (family: string, bold: boolean, italic: boolean) => string;
  }
  function SVGtoPDF(
    doc: typeof PDFDocument.prototype,
    svg: string,
    x?: number,
    y?: number,
    options?: SVGtoPDFOptions
  ): void;
  export default SVGtoPDF;
}
