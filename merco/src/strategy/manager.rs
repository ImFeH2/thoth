use crate::errors::AppResult;
use crate::strategy::handle::StrategyHandle;
use cargo_metadata::MetadataCommand;
use std::{fs, path::PathBuf};
use toml_edit::{DocumentMut, array, table, value};

const WORKSPACE_CARGO_TOML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/templates/strategy/Cargo.toml.template"
));
const MEMBER_CARGO_TOML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/templates/strategy/member/Cargo.toml.template"
));
const MEMBER_LIB_RS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/templates/strategy/member/src/lib.rs.template"
));
pub const STRATEGY_WORKDIR_NAME: &str = "strategies";

#[derive(Debug, Clone)]
pub struct StrategyManager {
    workspace_dir: PathBuf,
}

impl StrategyManager {
    pub fn new() -> AppResult<Self> {
        let current_dir = std::env::current_dir()?;
        let workspace_dir = current_dir.join(STRATEGY_WORKDIR_NAME);

        let mut initial = false;
        if !workspace_dir.is_dir() {
            if workspace_dir.exists() {
                return Err(format!(
                    "Create strategies dir failed: {}",
                    workspace_dir.to_string_lossy()
                )
                .into());
            }
            fs::create_dir_all(&workspace_dir)?;
            initial = true;
        }

        let workspace_toml = workspace_dir.join("Cargo.toml");
        if !workspace_toml.exists() {
            fs::write(workspace_toml, WORKSPACE_CARGO_TOML)?;
        }

        let manager = Self { workspace_dir };

        if initial {
            manager.add_strategy("my-strategy")?;
        }

        Ok(manager)
    }

    pub fn add_strategy(&self, strategy_name: &str) -> AppResult<()> {
        let workspace_toml_path = self.workspace_dir.join("Cargo.toml");
        let mut workspace_toml: DocumentMut = fs::read_to_string(&workspace_toml_path)?.parse()?;

        let members = workspace_toml["workspace"].or_insert(table())["members"]
            .or_insert(array())
            .as_array_mut()
            .unwrap();

        if members.iter().any(|m| m.as_str().unwrap() == strategy_name) {
            return Err("Strategy exist".into());
        }

        members.push(strategy_name);
        fs::write(workspace_toml_path, workspace_toml.to_string())?;

        let strategy_dir = self.workspace_dir.join(strategy_name);
        if strategy_dir.exists() {
            return Err("Strategy directory path not empty".into());
        }

        fs::create_dir_all(&strategy_dir)?;

        let mut cargo_toml: DocumentMut = MEMBER_CARGO_TOML.parse()?;
        cargo_toml["package"]["name"] = value(strategy_name);

        let dependency_merco = cargo_toml["dependencies"]["merco"]
            .as_inline_table_mut()
            .unwrap();
        dependency_merco.insert("path", env!("CARGO_MANIFEST_DIR").into());

        let cargo_path = strategy_dir.join("Cargo.toml");
        fs::write(cargo_path, cargo_toml.to_string())?;

        let src_dir = strategy_dir.join("src");
        fs::create_dir_all(&src_dir)?;

        let lib_path = src_dir.join("lib.rs");
        fs::write(lib_path, MEMBER_LIB_RS)?;

        Ok(())
    }

    pub async fn load_strategy(&self, strategy_name: &str) -> AppResult<StrategyHandle> {
        let metadata = MetadataCommand::new()
            .current_dir(&self.workspace_dir)
            .exec()?;

        let _ = metadata
            .packages
            .iter()
            .find(|p| p.name == strategy_name)
            .ok_or(format!("Package '{}' not found", strategy_name))?;

        let status = tokio::process::Command::new("cargo")
            .args(["build", "--release", "--package", strategy_name])
            .current_dir(&self.workspace_dir)
            .status()
            .await?;

        if !status.success() {
            return Err("Build failed".into());
        }

        let target_dir = metadata.target_directory.as_std_path();

        #[cfg(target_os = "linux")]
        let lib_name = format!("lib{}.so", strategy_name.replace("-", "_"));

        #[cfg(target_os = "macos")]
        let lib_name = format!("lib{}.dylib", strategy_name.replace("-", "_"));

        #[cfg(target_os = "windows")]
        let lib_name = format!("{}.dll", strategy_name.replace("-", "_"));

        let lib_path = target_dir.join("release").join(&lib_name);

        if !lib_path.exists() {
            return Err(format!("Library not found: {:?}", lib_path).into());
        }

        StrategyHandle::try_from_path(&lib_path)
    }
}
