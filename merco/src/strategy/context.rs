use crate::errors::{AppError, AppResult};
use crate::models::{Candle, MarketPrecision, TradingFees};
use bigdecimal::{BigDecimal, RoundingMode, Zero};
use chrono::{DateTime, Utc, serde::ts_milliseconds};
use serde::Serialize;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TradeType {
    MarketBuy,
    MarketSell,
    LimitBuy,
    LimitSell,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Trade {
    #[serde(with = "ts_milliseconds")]
    #[ts(type = "number")]
    pub timestamp: DateTime<Utc>,
    pub trade_type: TradeType,
    #[ts(type = "string")]
    pub price: BigDecimal,
    #[ts(type = "string")]
    pub amount: BigDecimal,
    #[ts(type = "string")]
    pub fee: BigDecimal,
    #[ts(optional, type = "string")]
    pub profit: Option<BigDecimal>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum OrderType {
    LimitBuy,
    LimitSell,
}

#[derive(Debug, Clone)]
pub struct Order {
    pub id: Uuid,
    pub order_type: OrderType,
    pub price: BigDecimal,
    pub amount: BigDecimal,
    pub fee: BigDecimal,
}

#[derive(Debug, Clone)]
pub struct StrategyContext {
    pub(crate) candles: Vec<Candle>,
    pub(crate) balance: BigDecimal,
    pub(crate) position: BigDecimal,
    pub(crate) trades: Vec<Trade>,
    pub(crate) orders: Vec<Order>,
    pub(crate) fees: TradingFees,
    pub(crate) precision: MarketPrecision,
}

impl StrategyContext {
    pub(crate) fn new(
        balance: BigDecimal,
        fees: TradingFees,
        precision: MarketPrecision,
    ) -> AppResult<Self> {
        Ok(Self {
            candles: Vec::new(),
            balance,
            position: BigDecimal::zero(),
            trades: Vec::new(),
            orders: Vec::new(),
            fees,
            precision,
        })
    }

    pub(crate) fn before(&mut self) -> AppResult<()> {
        let candle = self.candle()?;
        let mut orders_to_execute = Vec::new();

        for order in &self.orders {
            match order.order_type {
                OrderType::LimitBuy => {
                    if order.price >= candle.low {
                        orders_to_execute.push((
                            order.id,
                            OrderType::LimitBuy,
                            order.price.clone(),
                            order.amount.clone(),
                            order.fee.clone(),
                        ));
                    }
                }
                OrderType::LimitSell => {
                    if order.price <= candle.high {
                        orders_to_execute.push((
                            order.id,
                            OrderType::LimitSell,
                            order.price.clone(),
                            order.amount.clone(),
                            order.fee.clone(),
                        ));
                    }
                }
            }
        }

        for (order_id, order_type, price, amount, fee) in orders_to_execute {
            match order_type {
                OrderType::LimitBuy => {
                    self.execute_limit_buy(&candle, &price, &amount, &fee);
                }
                OrderType::LimitSell => {
                    self.execute_limit_sell(&candle, &price, &amount, &fee);
                }
            }
            self.orders.retain(|o| o.id != order_id);
        }

        Ok(())
    }

    pub(crate) fn after(&mut self) -> AppResult<()> {
        Ok(())
    }

    pub(crate) fn end(&mut self) -> AppResult<()> {
        let order_ids: Vec<Uuid> = self.orders.iter().map(|o| o.id).collect();
        for id in order_ids {
            self.cancel_order(id);
        }
        Ok(())
    }

    pub fn candles(&self) -> &[Candle] {
        &self.candles
    }

    pub fn candle(&self) -> AppResult<Candle> {
        self.candles
            .last()
            .cloned()
            .ok_or(AppError::Strategy("No candles available".into()))
    }

    pub fn balance(&self) -> BigDecimal {
        self.balance.clone()
    }

    pub fn position(&self) -> BigDecimal {
        self.position.clone()
    }

    pub fn trades(&self) -> &[Trade] {
        &self.trades
    }

    pub fn orders(&self) -> &[Order] {
        &self.orders
    }

    pub fn precision(&self) -> &MarketPrecision {
        &self.precision
    }

    pub fn cancel_order(&mut self, order_id: Uuid) {
        if let Some(pos) = self.orders.iter().position(|o| o.id == order_id) {
            let order = &self.orders[pos];
            match order.order_type {
                OrderType::LimitBuy => {
                    let refund = &order.price * &order.amount + &order.fee;
                    self.balance += &refund;
                }
                OrderType::LimitSell => {
                    self.position += &order.amount;
                    self.balance += &order.fee;
                }
            }
            self.orders.remove(pos);
        }
    }

    pub fn market_buy(&mut self, amount: &BigDecimal) -> AppResult<()> {
        let amount = self.precision.round_amount(amount, RoundingMode::Down);

        if amount <= BigDecimal::zero() {
            return Err(AppError::Strategy("Amount must be positive".into()));
        }

        let candle = self.candle()?;
        let price = candle.close;

        let cost = &price * &amount;
        let fee = &cost * &self.fees.taker;
        let fee = self.precision.round_amount(&fee, RoundingMode::Up);
        let total = &cost + &fee;

        if total > self.balance {
            return Err(AppError::Strategy("Insufficient funds".into()));
        }

        self.balance -= &total;
        self.position += &amount;

        self.trades.push(Trade {
            timestamp: candle.timestamp,
            trade_type: TradeType::MarketBuy,
            price,
            amount,
            fee,
            profit: None,
        });

        Ok(())
    }

    pub fn market_sell(&mut self, amount: &BigDecimal) -> AppResult<()> {
        let amount = self.precision.round_amount(amount, RoundingMode::Down);

        if amount <= BigDecimal::zero() {
            return Err(AppError::Strategy("Amount must be positive".into()));
        }

        if amount > self.position {
            return Err(AppError::Strategy(
                "Insufficient base asset amount to sell".into(),
            ));
        }

        let candle = self.candle()?;
        let price = candle.close;

        let proceeds = &price * &amount;
        let fee = self
            .precision
            .round_amount(&(&proceeds * &self.fees.taker), RoundingMode::Up);
        let revenue = &proceeds - &fee;

        if revenue < BigDecimal::zero() {
            return Err(AppError::Strategy("Revenue cannot be negative".into()));
        }

        self.position -= &amount;
        self.balance += &revenue;

        self.trades.push(Trade {
            timestamp: candle.timestamp,
            trade_type: TradeType::MarketSell,
            price,
            amount,
            fee,
            profit: None,
        });

        Ok(())
    }

    pub fn limit_buy(
        &mut self,
        price: &BigDecimal,
        amount: &BigDecimal,
    ) -> AppResult<Option<Uuid>> {
        let price = self.precision.round_amount(price, RoundingMode::Down);
        let amount = self.precision.round_amount(amount, RoundingMode::Down);

        if amount <= BigDecimal::zero() {
            return Err(AppError::Strategy("Amount must be positive".into()));
        }

        let candle = self.candle()?;

        if price >= candle.close {
            self.market_buy(&amount)?;
            return Ok(None);
        };

        let cost = &amount * &price;
        let fee = &cost * &self.fees.maker;
        let fee = self.precision.round_amount(&fee, RoundingMode::Up);
        let total = &cost + &fee;

        if total > self.balance {
            return Err(AppError::Strategy("Insufficient funds".into()));
        }

        self.balance -= &total;

        let order_id = Uuid::new_v4();
        self.orders.push(Order {
            id: order_id,
            order_type: OrderType::LimitBuy,
            price,
            amount,
            fee,
        });

        Ok(Some(order_id))
    }

    pub fn limit_sell(
        &mut self,
        price: &BigDecimal,
        amount: &BigDecimal,
    ) -> AppResult<Option<Uuid>> {
        let price = self.precision.round_amount(price, RoundingMode::Down);
        let amount = self.precision.round_amount(amount, RoundingMode::Down);

        if amount <= BigDecimal::zero() {
            return Err(AppError::Strategy("Amount must be positive".into()));
        }

        if amount > self.position {
            return Err(AppError::Strategy(
                "Insufficient base asset amount to sell".into(),
            ));
        }

        let candle = self.candle()?;
        if price <= candle.close {
            self.market_sell(&amount)?;
            return Ok(None);
        };

        let proceeds = &price * &amount;
        let fee = self
            .precision
            .round_amount(&(&proceeds * &self.fees.maker), RoundingMode::Up);

        if fee > self.balance {
            return Err(AppError::Strategy("Insufficient funds to cover fee".into()));
        }

        self.position -= &amount;
        self.balance -= &fee;

        let order_id = Uuid::new_v4();
        self.orders.push(Order {
            id: order_id,
            order_type: OrderType::LimitSell,
            price,
            amount,
            fee,
        });

        Ok(Some(order_id))
    }

    fn execute_limit_buy(
        &mut self,
        candle: &Candle,
        price: &BigDecimal,
        amount: &BigDecimal,
        fee: &BigDecimal,
    ) {
        self.position += amount;

        let trade = Trade {
            timestamp: candle.timestamp,
            trade_type: TradeType::LimitBuy,
            price: price.clone(),
            amount: amount.clone(),
            fee: fee.clone(),
            profit: None,
        };

        self.trades.push(trade);
    }

    fn execute_limit_sell(
        &mut self,
        candle: &Candle,
        price: &BigDecimal,
        amount: &BigDecimal,
        fee: &BigDecimal,
    ) {
        let proceeds = price * amount;
        self.balance += &proceeds;

        let trade = Trade {
            timestamp: candle.timestamp,
            trade_type: TradeType::LimitSell,
            price: price.clone(),
            amount: amount.clone(),
            fee: fee.clone(),
            profit: None,
        };

        self.trades.push(trade);
    }
}
