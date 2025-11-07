use crate::app::AppState;
use crate::errors::{ApiResult, AppError};
use crate::models::Timeframe;
use crate::tasks::{BacktestStatus, BacktestTask};
use axum::{
    extract::{Path, State},
    response::{
        Json,
        sse::{Event, KeepAlive, Sse},
    },
};
use chrono::Utc;
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::RwLock;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateBacktestTaskRequest {
    pub name: String,
    pub exchange: String,
    pub symbol: String,
    pub timeframe: Timeframe,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CreateBacktestTaskResponse {
    pub task_id: Uuid,
}

pub async fn create_task(
    State(state): State<AppState>,
    Json(request): Json<CreateBacktestTaskRequest>,
) -> ApiResult<CreateBacktestTaskResponse> {
    let mut strategy_handle = state.strategy_manager.load_strategy(&request.name).await?;

    let ccxt = crate::exchange::ccxt::CCXT::with_exchange(&request.exchange)?;
    let precision = ccxt.precision(&request.symbol)?;

    let now = Utc::now();
    let task = BacktestTask {
        id: Uuid::new_v4(),
        status: BacktestStatus::Pending,
        progress: 0.0,
        name: request.name.clone(),
        exchange: request.exchange.clone(),
        symbol: request.symbol.clone(),
        timeframe: request.timeframe,
        precision,
        statistic: None,
        error_message: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        updated_at: now,
        event_tx: state.backtest_event_tx.clone(),
    };
    task.broadcast();

    let task_id = task.id;
    let task = Arc::new(RwLock::new(task));

    {
        let mut tasks = state.backtest_tasks.write().await;
        tasks.insert(task_id, task.clone());
    }

    let db_pool = state.db_pool.clone();
    tokio::spawn(async move {
        let mut task = task.write().await;
        task.execute(db_pool, &mut strategy_handle).await;
    });

    Ok(Json(CreateBacktestTaskResponse { task_id }))
}

pub async fn get_all_tasks(State(state): State<AppState>) -> ApiResult<Vec<BacktestTask>> {
    let mut tasks = Vec::new();
    let backtest_tasks = state.backtest_tasks.read().await;
    for task in backtest_tasks.values() {
        let task = task.read().await;
        tasks.push(task.clone());
    }

    Ok(Json(tasks))
}

pub async fn get_task(
    State(state): State<AppState>,
    Path(task_id): Path<Uuid>,
) -> ApiResult<BacktestTask> {
    let backtest_tasks = state.backtest_tasks.read().await;
    let task = backtest_tasks.get(&task_id);

    match task {
        Some(task) => {
            let task = task.read().await;
            Ok(Json(task.clone()))
        }
        _ => Err(AppError::NotFound(format!(
            "Task with id '{}' is not a Backtest task",
            task_id
        ))),
    }
}

pub async fn stream_tasks(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.backtest_event_tx.subscribe();
    let mut initial_events = Vec::new();
    {
        let backtest_tasks = state.backtest_tasks.read().await;
        for task in backtest_tasks.values() {
            let task = task.read().await;
            if let Ok(data) = serde_json::to_string(&*task) {
                initial_events.push(data);
            }
        }
    }

    let stream = async_stream::stream! {
        for data in initial_events {
            yield Ok(Event::default().data(data));
        }

        loop {
            tokio::select! {
                _ = state.shutdown_token.cancelled() => {
                    break;
                }
                result = rx.recv() => {
                    let Ok(task) = result else {
                        break;
                    };

                    let Ok(data) = serde_json::to_string(&task) else {
                        continue;
                    };

                    yield Ok(Event::default().data(data));
                }
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}
