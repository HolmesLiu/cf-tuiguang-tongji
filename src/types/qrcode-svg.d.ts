declare module 'qrcode-svg' {
  interface QRCodeOptions {
    content: string;
    padding?: number;
    width?: number;
    height?: number;
    color?: string;
    background?: string;
    ecl?: 'L' | 'M' | 'Q' | 'H';
    join?: string;
    container?: string;
    xmlDeclaration?: boolean;
  }
  class QRCode {
    constructor(options: QRCodeOptions);
    svg(opt?: object): string;
  }
  export default QRCode;
}
