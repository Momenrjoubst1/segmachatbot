import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  NewChatButtonFull,
  NewChatButtonIcon,
} from "@/features/ai-assistant/shadcn/components/Sidebar/NewChatButton";

const renderWithTooltip = (ui: React.ReactElement) =>
  render(<TooltipProvider>{ui}</TooltipProvider>);

describe("NewChatButtonFull", () => {
  it("renders icon, label, and shortcut as separate elements", () => {
    renderWithTooltip(<NewChatButtonFull onClick={() => {}} />);
    const button = screen.getByTestId("new-chat-button-full");
    expect(button).toBeInTheDocument();
    expect(screen.getByText("New Chat")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+O")).toBeInTheDocument();
    // The icon must live inside its own wrapper element (not a bare SVG)
    expect(button.querySelector(".icon-wrapper svg")).toBeInTheDocument();
  });

  it("invokes onClick when clicked", () => {
    const onClick = vi.fn();
    renderWithTooltip(<NewChatButtonFull onClick={onClick} />);
    fireEvent.click(screen.getByTestId("new-chat-button-full"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has an accessible name for screen readers", () => {
    renderWithTooltip(<NewChatButtonFull onClick={() => {}} />);
    expect(screen.getByLabelText("New Chat")).toBeInTheDocument();
  });
});

describe("NewChatButtonIcon", () => {
  it("renders the icon inside a wrapper without any visible label", () => {
    renderWithTooltip(<NewChatButtonIcon onClick={() => {}} />);
    const button = screen.getByTestId("new-chat-button-icon");
    expect(button).toBeInTheDocument();
    expect(button.querySelector(".icon-wrapper svg")).toBeInTheDocument();
    expect(screen.queryByText("New Chat")).not.toBeInTheDocument();
  });

  it("invokes onClick when clicked", () => {
    const onClick = vi.fn();
    renderWithTooltip(<NewChatButtonIcon onClick={onClick} />);
    fireEvent.click(screen.getByTestId("new-chat-button-icon"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is keyboard accessible", () => {
    renderWithTooltip(<NewChatButtonIcon onClick={() => {}} />);
    expect(screen.getByLabelText("New Chat")).toBeInTheDocument();
  });
});
