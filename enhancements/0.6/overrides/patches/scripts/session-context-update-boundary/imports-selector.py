import json
import os
import re
import subprocess
from pathlib import Path

from .active_task import resolve_context_key
from .config import get_git_packages
