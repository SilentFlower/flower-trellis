"""仅按真实平台能力处理测试前提，不吞掉被测逻辑的错误。"""

import os
import unittest
from pathlib import Path


def symlink_or_skip(target, link, target_is_directory=False):
    """创建测试软链，仅在 Windows 明确缺少软链权限时跳过。

    @param target: 链接目标。
    @param link: 待创建链接路径。
    @param target_is_directory: 目标是否为目录。
    @return: 无返回值；其它 I/O 错误原样抛出。
    """
    try:
        Path(link).symlink_to(target, target_is_directory=target_is_directory)
    except OSError as error:
        if os.name == "nt" and getattr(error, "winerror", None) == 1314:
            raise unittest.SkipTest("当前 Windows 用户没有创建符号链接的权限（WinError 1314）") from error
        raise
