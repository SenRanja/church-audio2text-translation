export type ApiTelemetry = (
  event: string,
  details?: Record<string, string | number | boolean | undefined>,
) => void;