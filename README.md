# Thoth

A high-performance algorithmic trading platform built with Rust and React.

## Features

- Fetch and store market data from multiple exchanges
- Write custom trading strategies in Rust
- Backtest strategies against historical data
- Interactive candlestick charts with market data visualization
- Built-in code editor for strategy development

## Tech Stack

**Backend**: Rust, Axum, SQLx, TimescaleDB

**Frontend**: React, TypeScript, Tailwind CSS, Monaco Editor

## Quick Start

### Setup

```bash
# 1. Clone and setup environment
git clone https://github.com/ImFeH2/thoth.git
cd thoth

# 2. Start database (if using Docker)
cd docker
docker compose up -d
cd ..

# 3. Run Database Migrations
cd thoth
sqlx migrate run
cd ..

# 4. Start backend
cargo run --release

# 5. Start frontend (in new terminal)
cd frontend
pnpm install
pnpm dev
```

Visit `http://localhost:5173`

## Writing Strategies

Strategies are written as Rust structs implementing the `Strategy` trait:

```rust
use thoth::{strategy, AppResult, Strategy, StrategyContext};

#[strategy]
struct MyStrategy {
    // Add any fields you need for your strategy
    short_period: usize,
    long_period: usize,
}

impl Strategy for MyStrategy {
    fn tick(&mut self, ctx: &mut StrategyContext) -> AppResult<()> {
        // Access market data
        let candles = ctx.candles();
        let balance = ctx.balance();
        let position = ctx.position();

        // Place orders
        ctx.market_buy(&amount)?;
        ctx.market_sell(&amount)?;
        ctx.limit_buy(&price, &amount)?;
        ctx.limit_sell(&price, &amount)?;

        Ok(())
    }
}
```

### Strategy API

**Market Data Access:**

- `ctx.candles()` - Get all historical candles
- `ctx.candle()` - Get the most recent candle
- `ctx.balance()` - Get current quote currency balance
- `ctx.position()` - Get current base currency position
- `ctx.precision()` - Get market precision info

**Order Execution:**

- `ctx.market_buy(amount)` - Execute market buy order
- `ctx.market_sell(amount)` - Execute market sell order
- `ctx.limit_buy(price, amount)` - Place limit buy order
- `ctx.limit_sell(price, amount)` - Place limit sell order
- `ctx.orders()` - Get all pending orders
- `ctx.cancel_order(order_id)` - Cancel pending order

**Trade History:**

- `ctx.trades()` - Get all executed trades
