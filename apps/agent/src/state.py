from typing import Optional, Any
from copilotkit import CopilotKitState


class AgentState(CopilotKitState):
    """
    Liquid agent state.

    Extends CopilotKitState (which includes messages + copilotkit fields)
    with the four domain-specific fields driven entirely by frontend controls.
    """
    inputText: str
    controls: Optional[Any]     # ControlSchema serialised as dict, or None
    activeValues: dict           # { [controlId]: number | boolean }
    outputText: str
    sessionId: str
