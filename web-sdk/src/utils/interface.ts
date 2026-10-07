export * from '../core/recognizers/IDScan/IDScanResult';
export * from '../core/recognizers/IDScan/IDScan';
export * from '../core/recognizers/FaceScan/FaceScan';
export * from '../core/lib/Interfaces';
export * from '../core/lib/Browser';
export * from '../core/lib/DeviceProfiler';
export * from '../core/lib/Session';
export * from '../core/lib/Scanner';
export * from '../core/lib/Orientation';
export * from '../core/recognizers/Recognizer';
export * from '../core/lib/SdkError';
export * from '../core/SDK';
export * from '../core/SDKManager';

export interface IDVerseStatusButtons {
  readonly label: string;
  readonly variant: string;
  readonly disabled?: boolean;
  readonly onClick?: { (): void };
}
