declare module 'qrcode' {
  interface ToStringOptions {
    type?: 'svg' | 'utf8' | 'terminal';
    margin?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark?: string; light?: string };
  }

  const QRCode: {
    toString(text: string, options?: ToStringOptions): Promise<string>;
  };

  export default QRCode;
}
