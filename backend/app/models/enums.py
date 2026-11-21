"""模型层枚举

``DocumentStatus`` 描述 ``kb_document.status`` 列的取值。

设计说明
--------
数据库中的 ``status`` 列是 **Integer**，而不是 SQLAlchemy ``Enum``。
因此这里用 Python 侧 ``IntEnum`` 表达同一套取值：

* 存入数据库时是普通整数（SQLite / MySQL 行为一致）；
* 从数据库读回来的是 ``int``，但 ``IntEnum`` 是 ``int`` 的子类，
  ``doc.status == DocumentStatus.SYNCED`` 这类比较依然成立；
* 调用方也可以显式使用 ``DocumentStatus.PENDING.value``。
"""

from enum import IntEnum


class DocumentStatus(IntEnum):
    """文档索引同步状态

    1 = PENDING   待索引（新建/上传尚未同步到向量库）
    2 = OUTDATED  待更新（已同步文档正文或元信息被修改）
    3 = SYNCED    已同步（数据库与向量库一致）
    4 = FAILED    失败（同步或重建索引失败）
    """

    PENDING = 1
    OUTDATED = 2
    SYNCED = 3
    FAILED = 4

    # 兼容旧代码的别名
    UPLOADED = 1
    PROCESSING = 2
    READY = 3
