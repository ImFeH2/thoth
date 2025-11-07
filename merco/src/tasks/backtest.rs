use crate::errors::AppResult;
use crate::exchange::ccxt::CCXT;
use crate::models::{Candle, MarketPrecision, Timeframe};
use crate::services::candles::get_candles;
use crate::strategy::{StrategyContext, StrategyHandle, Trade, TradeType};
use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive, Zero};
use chrono::{DateTime, Utc, serde::ts_milliseconds, serde::ts_milliseconds_option};
use serde::Serialize;
use sqlx::PgPool;
use tokio::sync::broadcast;
use ts_rs::TS;
use uuid::Uuid;

const BACKTEST_BROADCAST_INTERVAL: usize = 100;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct BacktestStatistic {
    pub trades: Vec<Trade>,
    #[ts(type = "string")]
    pub initial_capital: BigDecimal,
    #[ts(type = "string")]
    pub total_cost: BigDecimal,
    #[ts(type = "string")]
    pub net_profit: BigDecimal,
    pub return_percent: f32,
    #[ts(type = "string")]
    pub max_equity: BigDecimal,
    #[ts(type = "string")]
    pub max_drawdown: BigDecimal,
    pub max_drawdown_percent: f32,
    #[ts(type = "string")]
    pub gross_profit: BigDecimal,
    #[ts(type = "string")]
    pub gross_loss: BigDecimal,
    pub profit_factor: f32,
    pub sharpe_ratio: f32,
    pub total_trades: usize,
    pub buy_trades: usize,
    pub sell_trades: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub win_rate: f32,
    #[ts(type = "string")]
    pub avg_win: BigDecimal,
    #[ts(type = "string")]
    pub avg_loss: BigDecimal,
    #[ts(type = "string")]
    pub largest_win: BigDecimal,
    #[ts(type = "string")]
    pub largest_loss: BigDecimal,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BacktestStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct BacktestTask {
    pub id: Uuid,
    pub status: BacktestStatus,
    pub progress: f32,
    pub name: String,
    pub exchange: String,
    pub symbol: String,
    pub timeframe: Timeframe,
    pub precision: MarketPrecision,
    #[ts(optional)]
    pub statistic: Option<BacktestStatistic>,
    #[ts(optional)]
    pub error_message: Option<String>,
    #[serde(with = "ts_milliseconds")]
    #[ts(type = "number")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "ts_milliseconds_option")]
    #[ts(optional, type = "number")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(with = "ts_milliseconds_option")]
    #[ts(optional, type = "number")]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(with = "ts_milliseconds")]
    #[ts(type = "number")]
    pub updated_at: DateTime<Utc>,
    #[serde(skip)]
    #[ts(skip)]
    pub event_tx: broadcast::Sender<BacktestTask>,
}

impl BacktestTask {
    pub fn broadcast(&self) {
        let _ = self.event_tx.send(self.clone());
    }

    pub async fn execute(&mut self, db_pool: PgPool, strategy_handle: &mut StrategyHandle) {
        let now = Utc::now();
        self.status = BacktestStatus::Running;
        self.started_at = Some(now);
        self.updated_at = now;
        self.broadcast();

        let result = self.execute_backtest(db_pool, strategy_handle).await;
        let now = Utc::now();
        match result {
            Ok(statistic) => {
                self.status = BacktestStatus::Completed;
                self.progress = 100.0;
                self.statistic = Some(statistic);
                self.completed_at = Some(now);
                self.updated_at = now;
            }
            Err(e) => {
                self.status = BacktestStatus::Failed;
                self.error_message = Some(e.to_string());
                self.completed_at = Some(now);
                self.updated_at = now;
            }
        };

        self.broadcast();
    }

    async fn execute_backtest(
        &mut self,
        db_pool: PgPool,
        strategy_handle: &mut StrategyHandle,
    ) -> AppResult<BacktestStatistic> {
        let exchange = self.exchange.clone();
        let symbol = self.symbol.clone();
        let timeframe = self.timeframe;

        tracing::info!(
            "Running backtest on {}/{} with timeframe {}",
            exchange,
            symbol,
            timeframe
        );

        let all_candles = get_candles(&db_pool, &exchange, &symbol, timeframe, None, None).await?;
        let total_candles = all_candles.len();
        if total_candles == 0 {
            return Err("No candles available for backtest".into());
        }

        let initial_capital = BigDecimal::from(10000);
        let ccxt = CCXT::with_exchange(&exchange)?;
        let fees = ccxt.fees(&symbol)?;
        let precision = ccxt.precision(&symbol)?;
        let mut context = StrategyContext::new(initial_capital.clone(), fees, precision)?;

        for (index, candle) in all_candles.iter().cloned().enumerate() {
            context.candles.push(candle);

            context.before()?;
            strategy_handle.tick(&mut context)?;
            context.after()?;

            if index % BACKTEST_BROADCAST_INTERVAL == 0 {
                let progress = 100.0 * ((index + 1) as f32) / (total_candles as f32);
                self.progress = progress;
                self.updated_at = Utc::now();
                self.broadcast();
            }
        }

        context.end()?;
        self.progress = 100.0;
        self.updated_at = Utc::now();
        self.broadcast();

        let backtest_stat = Self::calculate_backtest_statistic(
            initial_capital,
            context.candles(),
            context.trades(),
        );

        Ok(backtest_stat)
    }

    fn calculate_backtest_statistic(
        initial_capital: BigDecimal,
        candles: &[Candle],
        trades: &[Trade],
    ) -> BacktestStatistic {
        let mut balance = initial_capital.clone();
        let mut position = BigDecimal::zero();
        let mut total_cost = BigDecimal::zero();
        let mut max_equity = initial_capital.clone();
        let mut max_drawdown = BigDecimal::zero();
        let mut max_drawdown_percent = 0.0f32;

        let mut buy_trades = 0usize;
        let mut sell_trades = 0usize;
        let mut winning_trades = 0usize;
        let mut losing_trades = 0usize;
        let mut gross_profit = BigDecimal::zero();
        let mut gross_loss = BigDecimal::zero();
        let mut largest_win = BigDecimal::zero();
        let mut largest_loss = BigDecimal::zero();

        let mut trades_iter = trades.iter().peekable();
        let mut trades_with_profit = Vec::with_capacity(trades.len());

        for candle in candles.iter() {
            while let Some(trade) = trades_iter.peek() {
                if trade.timestamp > candle.timestamp {
                    break;
                }

                let trade = trades_iter.next().unwrap();
                let is_buy = matches!(trade.trade_type, TradeType::MarketBuy | TradeType::LimitBuy);

                if is_buy {
                    buy_trades += 1;
                    let cost = &trade.price * &trade.amount + &trade.fee;
                    total_cost += &cost;
                    balance -= &cost;
                    position += &trade.amount;
                    trades_with_profit.push(trade.clone());
                } else {
                    sell_trades += 1;
                    let proceeds = &trade.price * &trade.amount;
                    let revenue = &proceeds - &trade.fee;
                    let average_cost = if position.is_zero() {
                        BigDecimal::zero()
                    } else {
                        &total_cost / &position
                    };
                    let profit = &revenue - (&average_cost * &trade.amount);

                    position -= &trade.amount;
                    balance += &revenue;

                    if position.is_zero() {
                        total_cost = BigDecimal::zero();
                    } else {
                        total_cost -= &average_cost * &trade.amount;
                    }

                    if profit > BigDecimal::zero() {
                        winning_trades += 1;
                        gross_profit += &profit;
                        if profit > largest_win {
                            largest_win = profit.clone();
                        }
                    } else if profit < BigDecimal::zero() {
                        losing_trades += 1;
                        gross_loss += &profit;
                        if profit < largest_loss {
                            largest_loss = profit.clone();
                        }
                    }

                    trades_with_profit.push(Trade {
                        timestamp: trade.timestamp,
                        trade_type: trade.trade_type.clone(),
                        price: trade.price.clone(),
                        amount: trade.amount.clone(),
                        fee: trade.fee.clone(),
                        profit: Some(profit.clone()),
                    });
                }
            }

            let high_value = &position * &candle.high + &balance;
            if high_value > max_equity {
                max_equity = high_value;
            }

            let low_value = &position * &candle.low + &balance;
            let drawdown = &max_equity - &low_value;
            if drawdown > max_drawdown {
                max_drawdown = drawdown.clone();
                if !max_equity.is_zero() {
                    max_drawdown_percent =
                        (&drawdown / &max_equity).to_f32().unwrap_or(0.0) * 100.0;
                }
            }
        }

        while let Some(trade) = trades_iter.next() {
            let is_buy = matches!(trade.trade_type, TradeType::MarketBuy | TradeType::LimitBuy);

            if is_buy {
                buy_trades += 1;
                let cost = &trade.price * &trade.amount + &trade.fee;
                total_cost += &cost;
                balance -= &cost;
                position += &trade.amount;
                trades_with_profit.push(trade.clone());
            } else {
                sell_trades += 1;
                let proceeds = &trade.price * &trade.amount;
                let revenue = &proceeds - &trade.fee;
                let average_cost = if position.is_zero() {
                    BigDecimal::zero()
                } else {
                    &total_cost / &position
                };
                let profit = &revenue - (&average_cost * &trade.amount);

                position -= &trade.amount;
                balance += &revenue;

                if position.is_zero() {
                    total_cost = BigDecimal::zero();
                } else {
                    total_cost -= &average_cost * &trade.amount;
                }

                if profit > BigDecimal::zero() {
                    winning_trades += 1;
                    gross_profit += &profit;
                    if profit > largest_win {
                        largest_win = profit.clone();
                    }
                } else if profit < BigDecimal::zero() {
                    losing_trades += 1;
                    gross_loss += &profit;
                    if profit < largest_loss {
                        largest_loss = profit.clone();
                    }
                }

                trades_with_profit.push(Trade {
                    timestamp: trade.timestamp,
                    trade_type: trade.trade_type.clone(),
                    price: trade.price.clone(),
                    amount: trade.amount.clone(),
                    fee: trade.fee.clone(),
                    profit: Some(profit.clone()),
                });
            }
        }

        let total_trades = buy_trades + sell_trades;
        let win_rate = if sell_trades > 0 {
            (winning_trades as f32 / sell_trades as f32) * 100.0
        } else {
            0.0
        };

        let avg_win = if winning_trades > 0 {
            (&gross_profit / BigDecimal::from(winning_trades as i64))
                .with_scale_round(2, RoundingMode::HalfUp)
        } else {
            BigDecimal::zero()
        };

        let avg_loss = if losing_trades > 0 {
            (&gross_loss / BigDecimal::from(losing_trades as i64))
                .with_scale_round(2, RoundingMode::HalfUp)
        } else {
            BigDecimal::zero()
        };

        let profit_factor = if gross_loss.is_zero() {
            if !gross_profit.is_zero() {
                f32::INFINITY
            } else {
                0.0
            }
        } else {
            (&gross_profit / &gross_loss.abs()).to_f32().unwrap_or(0.0)
        };

        let net_profit = (&gross_profit + &gross_loss).with_scale_round(2, RoundingMode::HalfUp);

        let return_percent = if !initial_capital.is_zero() {
            (&net_profit / &initial_capital).to_f32().unwrap_or(0.0) * 100.0
        } else {
            0.0
        };

        let sharpe_ratio = Self::calculate_sharpe_ratio(&trades_with_profit, &initial_capital);

        BacktestStatistic {
            trades: trades_with_profit,
            initial_capital,
            total_cost,
            net_profit,
            return_percent,
            max_equity,
            max_drawdown,
            max_drawdown_percent,
            gross_profit,
            gross_loss,
            profit_factor,
            sharpe_ratio,
            total_trades,
            buy_trades,
            sell_trades,
            winning_trades,
            losing_trades,
            win_rate,
            avg_win,
            avg_loss,
            largest_win,
            largest_loss,
        }
    }

    fn calculate_sharpe_ratio(trades: &[Trade], initial_capital: &BigDecimal) -> f32 {
        if trades.is_empty() {
            return 0.0;
        }

        let sell_trades: Vec<&Trade> = trades
            .iter()
            .filter(|t| {
                if let Some(profit) = &t.profit {
                    !profit.is_zero()
                } else {
                    false
                }
            })
            .collect();

        if sell_trades.is_empty() {
            return 0.0;
        }

        if sell_trades.len() == 1 {
            return f32::INFINITY;
        }

        let initial_capital_f64 = initial_capital.to_f64().unwrap_or(1.0);

        let returns: Vec<f64> = sell_trades
            .iter()
            .filter_map(|t| t.profit.as_ref())
            .map(|profit| profit.to_f64().unwrap_or(0.0) / initial_capital_f64)
            .collect();

        let mean_return = returns.iter().sum::<f64>() / returns.len() as f64;

        let variance = returns
            .iter()
            .map(|r| {
                let diff = r - mean_return;
                diff * diff
            })
            .sum::<f64>()
            / returns.len() as f64;

        let std_dev = variance.sqrt();

        if std_dev == 0.0 {
            return f32::INFINITY;
        }

        (mean_return / std_dev) as f32
    }
}
