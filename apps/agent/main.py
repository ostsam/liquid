import os
import warnings

# Load .env BEFORE importing any src modules that read env vars at import time
from dotenv import load_dotenv
_ = load_dotenv()

from fastapi import FastAPI
import uvicorn
from src.agent import graph
from copilotkit import LangGraphAGUIAgent
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

app = FastAPI()

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="liquidAgent",
        description="Liquid Control: generates bespoke controls for any pasted text and rewrites it according to user-controlled parameters.",
        graph=graph,
    ),
    path="/",
)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8123"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )


warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")
if __name__ == "__main__":
    main()
