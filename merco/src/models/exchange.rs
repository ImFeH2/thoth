use bigdecimal::{BigDecimal, RoundingMode, Zero};
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone)]
pub struct TradingFees {
    pub maker: BigDecimal,
    pub taker: BigDecimal,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct MarketPrecision {
    #[ts(type = "string")]
    pub price_precision: BigDecimal,
    #[ts(type = "string")]
    pub amount_precision: BigDecimal,
}

impl MarketPrecision {
    pub fn round_price(&self, value: &BigDecimal, mode: RoundingMode) -> BigDecimal {
        if self.price_precision.is_zero() {
            return value.clone();
        }

        let divided = value / &self.price_precision;
        let floored = divided.with_scale_round(0, mode);
        floored * &self.price_precision
    }

    pub fn round_amount(&self, value: &BigDecimal, mode: RoundingMode) -> BigDecimal {
        if self.amount_precision.is_zero() {
            return value.clone();
        }

        let divided = value / &self.amount_precision;
        let floored = divided.with_scale_round(0, mode);
        floored * &self.amount_precision
    }
}
