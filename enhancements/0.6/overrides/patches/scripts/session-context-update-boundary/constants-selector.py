_PACKAGE_NAME = "@mindfoldhq/trellis"
_UPDATE_CHECK_TIMEOUT_SECONDS = 1.0
_VERSION_RE = re.compile(
    r"^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?\s*$"
)
_VERSION_TOKEN_RE = re.compile(r"\b\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z.-]+)?\b")
