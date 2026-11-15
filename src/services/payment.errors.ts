export class PaymentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export class OutOfServiceAreaError extends PaymentError {
  constructor(failedPoints: string[]) {
    super(
      'OUT_OF_SERVICE_AREA',
      'This ride is outside the current service area.',
      400,
      { failedPoints }
    );
    this.name = 'OutOfServiceAreaError';
  }
}

export class ServiceAreaUnavailableError extends PaymentError {
  constructor(
    message = 'The service area is temporarily unavailable. Please try again later.'
  ) {
    super('SERVICE_AREA_UNAVAILABLE', message, 503);
    this.name = 'ServiceAreaUnavailableError';
  }
}

export class SettlementRulesNotConfiguredError extends Error {
  readonly code = 'COMMISSION_RULES_NOT_CONFIGURED';

  constructor(message = 'COMMISSION BUSINESS RULES NOT YET CONFIGURED') {
    super(message);
    this.name = 'SettlementRulesNotConfiguredError';
  }
}

export class UnsupportedMarketError extends PaymentError {
  constructor(message = 'Pickup is outside a supported ride market.') {
    super('UNSUPPORTED_MARKET', message, 400);
    this.name = 'UnsupportedMarketError';
  }
}

export class MarketPricingNotConfiguredError extends PaymentError {
  constructor(message = 'Fare pricing is not configured for this market.') {
    super('MARKET_PRICING_NOT_CONFIGURED', message, 409);
    this.name = 'MarketPricingNotConfiguredError';
  }
}

export class SettlementSettingsError extends PaymentError {
  constructor(message: string, statusCode = 400) {
    super('INVALID_SETTLEMENT_SETTINGS', message, statusCode);
    this.name = 'SettlementSettingsError';
  }
}
