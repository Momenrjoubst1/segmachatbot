import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/components/LoginPage";

// The shared test setup stubs navigation; this file verifies real route changes.
vi.mock("react-router-dom", async () => vi.importActual("react-router-dom"));

const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    signIn: authMocks.signIn,
    signUp: authMocks.signUp,
    isAuthLoading: false,
  }),
}));

function renderLogin(initialEntry: string | { pathname: string; state: { from: string } }) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Home</div>} />
        <Route path="/course" element={<div>Course</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage authentication flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns to the requested internal route after a session is created", async () => {
    authMocks.signIn.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route path="/start" element={<Navigate to="/login" state={{ from: "/course" }} replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/course" element={<div>Course</div>} />
        </Routes>
      </MemoryRouter>,
    );

    // SignupPage is a lazy chunk inside <Suspense> — await the form before interacting.
    const email = await screen.findByLabelText(/signin\.emailLabel/i, {}, { timeout: 15000 });
    fireEvent.change(email, { target: { value: "guest@example.com" } });
    fireEvent.change(screen.getByLabelText(/signin\.passwordLabel/i), { target: { value: "password" } });
    fireEvent.submit(screen.getByRole("button", { name: /signin\.submit/i }).closest("form")!);

    await waitFor(() => expect(authMocks.signIn).toHaveBeenCalledWith("guest@example.com", "password"));
    await waitFor(() => expect(screen.getByText("Course")).toBeInTheDocument());
  }, 20000); // the whole test waits on the lazy chunk's cold import — 5s default is too tight for CI

  it("does not navigate after sign-up when email confirmation is required", async () => {
    authMocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
    renderLogin("/login");

    // The mode toggle lives in the lazy chunk too — await it first.
    fireEvent.click(
      await screen.findByRole("button", { name: /signup\.(noAccount|hasAccount)/i }, { timeout: 15000 })
    );
    fireEvent.change(screen.getByLabelText(/signin\.emailLabel/i), { target: { value: "guest@example.com" } });
    fireEvent.change(screen.getByLabelText(/signin\.passwordLabel/i), { target: { value: "password" } });
    fireEvent.submit(screen.getByRole("button", { name: /signup\.submit/i }).closest("form")!);

    await waitFor(() => expect(authMocks.signUp).toHaveBeenCalledWith("guest@example.com", "password"));
    await waitFor(() => expect(screen.getByText("signin.errors.emailNotConfirmed")).toBeInTheDocument());
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  }, 20000);
});
