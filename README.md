## 介绍

受够了python的导入, 路径太深每次都要 `.....x.y.z import foo`

## 特点

可以基于当前路径 自动导入函数

![img](media/demo.gif)

## 原理

本插件会自动检测 `__init__.py` 的 `__all__`导出的函数, 并追加提示词

## 运行时机

1. 运行 `Python Importer Refresh`
2. 当 `__init__.py` 文件保存时

## 配置

需要在工作路径配置 `pyproject.toml`

```toml
[tool.python-importer.import]
src = "src\xx"        # 项目路径, 会基于该路径扫描 __init__.py, 默认为"src"
exclude= [            # 要排除的文件夹名, 默认为 []
    "dist",
    "test",
]

```

## 计划

- [] 使用函数时自动导入
