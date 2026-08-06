export class RideVideoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}
