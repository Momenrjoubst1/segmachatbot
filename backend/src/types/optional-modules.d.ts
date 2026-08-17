// TypeScript declarations for optional runtime dependencies
// These packages are loaded dynamically at runtime and may not be installed

declare module "@xenova/transformers" {
  export function pipeline(
    task: string,
    modelId: string,
    options?: any
  ): Promise<any>;
}

declare module "mammoth" {
  interface ExtractRawTextResult {
    value: string;
    messages: any[];
  }

  export function extractRawText(options: {
    buffer: Buffer;
  }): Promise<ExtractRawTextResult>;

  const _default: {
    extractRawText(options: { buffer: Buffer }): Promise<ExtractRawTextResult>;
  };
  export default _default;
}

declare module "xlsx" {
  interface WorkBook {
    SheetNames: string[];
    Sheets: { [sheet: string]: WorkSheet };
  }

  interface WorkSheet {
    [key: string]: any;
  }

  interface SheetToCSVOptions {
    blankrows?: boolean;
  }

  export function read(data: Buffer, options: { type: string }): WorkBook;
  export const utils: {
    sheet_to_csv(sheet: WorkSheet, options?: SheetToCSVOptions): string;
  };

  const _default: {
    read(data: Buffer, options: { type: string }): WorkBook;
    utils: {
      sheet_to_csv(sheet: WorkSheet, options?: SheetToCSVOptions): string;
    };
  };
  export default _default;
}

declare module "@sendgrid/mail" {
  interface MailDataRequired {
    to: string | string[];
    from: string;
    subject: string;
    text?: string;
    html?: string;
  }

  export function setApiKey(apiKey: string): void;
  export function send(data: MailDataRequired | MailDataRequired[]): Promise<any>;

  const _default: {
    setApiKey(apiKey: string): void;
    send(data: MailDataRequired | MailDataRequired[]): Promise<any>;
  };
  export default _default;
}
