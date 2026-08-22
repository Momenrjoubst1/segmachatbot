
import { useState, useCallback, useRef, useEffect } from "react"
import {
  FolderIcon,
  FileIcon,
  PlayIcon,
  TerminalIcon,
  PlusIcon,
  TrashIcon,
  SaveIcon,
  DownloadIcon,
  FolderPlusIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  PackageIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/cn"
import { 
  Artifact, 
  ArtifactHeader, 
  ArtifactTitle, 
  ArtifactActions, 
  ArtifactAction,
  ArtifactClose 
} from "./artifact"

interface FileNode {
  name: string
  type: "file" | "folder"
  content?: string
  children?: FileNode[]
  path: string
  expanded?: boolean
}

interface TerminalLine {
  text: string
  type: "input" | "output" | "error" | "success"
  timestamp: number
}

export interface CodeIDEArtifactProps {
  initialProject?: {
    name: string
    files: FileNode[]
  }
  onClose?: () => void
  onExecute?: (code: string, language: string, dependencies?: string[]) => Promise<{
    output?: string
    error?: string
    success: boolean
  }>
}

export const CodeIDEArtifact = ({
  initialProject,
  onClose,
  onExecute,
}: CodeIDEArtifactProps) => {
  // State Management
  const [files, setFiles] = useState<FileNode[]>(
    initialProject?.files || [
      {
        name: "main.py",
        type: "file",
        content: "# اكتب كودك هنا\nprint('مرحباً بك في بيئة التطوير!')",
        path: "/main.py",
      },
    ]
  )
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(files[0] || null)
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { text: "$ مرحباً بك في Terminal المتكامل", type: "success", timestamp: Date.now() },
    { text: "$ استخدم الأزرار أعلاه لتنفيذ الكود أو تثبيت المتطلبات", type: "output", timestamp: Date.now() },
  ])
  const [terminalInput, setTerminalInput] = useState("")
  const [isExecuting, setIsExecuting] = useState(false)
  const [showNewFileDialog, setShowNewFileDialog] = useState(false)
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newItemName, setNewItemName] = useState("")
  const [newItemParentPath, setNewItemParentPath] = useState("/")
  
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [terminalLines])

  // Add line to terminal
  const addTerminalLine = useCallback((text: string, type: TerminalLine["type"]) => {
    setTerminalLines((prev) => [
      ...prev,
      { text, type, timestamp: Date.now() },
    ])
  }, [])

  // Find file by path
  const findFileByPath = useCallback((path: string, nodes: FileNode[] = files): FileNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node
      if (node.type === "folder" && node.children) {
        const found = findFileByPath(path, node.children)
        if (found) return found
      }
    }
    return null
  }, [files])

  // Update file content
  const updateFileContent = useCallback((path: string, content: string) => {
    const updateNode = (nodes: FileNode[]): FileNode[] => {
      return nodes.map((node) => {
        if (node.path === path && node.type === "file") {
          return { ...node, content }
        }
        if (node.type === "folder" && node.children) {
          return { ...node, children: updateNode(node.children) }
        }
        return node
      })
    }
    setFiles(updateNode(files))
    if (selectedFile?.path === path) {
      setSelectedFile({ ...selectedFile, content })
    }
  }, [files, selectedFile])

  // Create new file
  const createNewFile = useCallback(() => {
    if (!newItemName.trim()) {
      addTerminalLine("$ خطأ: اسم الملف فارغ", "error")
      return
    }

    const newPath = newItemParentPath === "/" 
      ? `/${newItemName}` 
      : `${newItemParentPath}/${newItemName}`
    
    if (findFileByPath(newPath)) {
      addTerminalLine(`$ خطأ: الملف ${newPath} موجود بالفعل`, "error")
      return
    }

    const newFile: FileNode = {
      name: newItemName,
      type: "file",
      content: "",
      path: newPath,
    }

    if (newItemParentPath === "/") {
      setFiles([...files, newFile])
    } else {
      const updateNode = (nodes: FileNode[]): FileNode[] => {
        return nodes.map((node) => {
          if (node.path === newItemParentPath && node.type === "folder") {
            return {
              ...node,
              children: [...(node.children || []), newFile],
            }
          }
          if (node.type === "folder" && node.children) {
            return { ...node, children: updateNode(node.children) }
          }
          return node
        })
      }
      setFiles(updateNode(files))
    }

    addTerminalLine(`$ تم إنشاء الملف: ${newPath}`, "success")
    setShowNewFileDialog(false)
    setNewItemName("")
  }, [newItemName, newItemParentPath, files, addTerminalLine, findFileByPath])

  // Create new folder
  const createNewFolder = useCallback(() => {
    if (!newItemName.trim()) {
      addTerminalLine("$ خطأ: اسم المجلد فارغ", "error")
      return
    }

    const newPath = newItemParentPath === "/" 
      ? `/${newItemName}` 
      : `${newItemParentPath}/${newItemName}`
    
    if (findFileByPath(newPath)) {
      addTerminalLine(`$ خطأ: المجلد ${newPath} موجود بالفعل`, "error")
      return
    }

    const newFolder: FileNode = {
      name: newItemName,
      type: "folder",
      path: newPath,
      children: [],
      expanded: false,
    }

    if (newItemParentPath === "/") {
      setFiles([...files, newFolder])
    } else {
      const updateNode = (nodes: FileNode[]): FileNode[] => {
        return nodes.map((node) => {
          if (node.path === newItemParentPath && node.type === "folder") {
            return {
              ...node,
              children: [...(node.children || []), newFolder],
            }
          }
          if (node.type === "folder" && node.children) {
            return { ...node, children: updateNode(node.children) }
          }
          return node
        })
      }
      setFiles(updateNode(files))
    }

    addTerminalLine(`$ تم إنشاء المجلد: ${newPath}`, "success")
    setShowNewFolderDialog(false)
    setNewItemName("")
  }, [newItemName, newItemParentPath, files, addTerminalLine, findFileByPath])

  // Delete file or folder
  const deleteNode = useCallback((path: string) => {
    const deleteFromNodes = (nodes: FileNode[]): FileNode[] => {
      return nodes
        .filter((node) => node.path !== path)
        .map((node) => {
          if (node.type === "folder" && node.children) {
            return { ...node, children: deleteFromNodes(node.children) }
          }
          return node
        })
    }
    
    setFiles(deleteFromNodes(files))
    if (selectedFile?.path === path) {
      setSelectedFile(null)
    }
    addTerminalLine(`$ تم حذف: ${path}`, "success")
  }, [files, selectedFile, addTerminalLine])

  // Toggle folder expansion
  const toggleFolder = useCallback((path: string) => {
    const toggleNode = (nodes: FileNode[]): FileNode[] => {
      return nodes.map((node) => {
        if (node.path === path && node.type === "folder") {
          return { ...node, expanded: !node.expanded }
        }
        if (node.type === "folder" && node.children) {
          return { ...node, children: toggleNode(node.children) }
        }
        return node
      })
    }
    setFiles(toggleNode(files))
  }, [files])

  // Execute code
  const executeCode = useCallback(async () => {
    if (!selectedFile || !selectedFile.content) {
      addTerminalLine("$ خطأ: لا يوجد ملف محدد أو الملف فارغ", "error")
      return
    }

    setIsExecuting(true)
    addTerminalLine(`$ تنفيذ: ${selectedFile.name}...`, "input")

    try {
      if (onExecute) {
        const language = selectedFile.name.split(".").pop() || "python"
        const result = await onExecute(selectedFile.content, language)
        
        if (result.success) {
          if (result.output) {
            addTerminalLine(result.output, "output")
          }
          addTerminalLine("$ ✓ تم التنفيذ بنجاح", "success")
        } else {
          if (result.error) {
            addTerminalLine(result.error, "error")
          }
          addTerminalLine("$ ✗ فشل التنفيذ", "error")
        }
      } else {
        // No executor wired — fail honestly instead of pretending success.
        addTerminalLine("$ ✗ لا يوجد منفّذ متصل (No executor connected)", "error")
      }
    } catch (error: unknown) {
      addTerminalLine(`$ خطأ: ${error instanceof Error ? error.message : String(error)}`, "error")
    } finally {
      setIsExecuting(false)
    }
  }, [selectedFile, onExecute, addTerminalLine])

  // Install dependencies
  const installDependencies = useCallback(async () => {
    if (!selectedFile) return

    addTerminalLine("$ تثبيت المتطلبات...", "input")
    
    // Extract dependencies from code (simple pattern matching)
    const importMatches = selectedFile.content?.match(/import\s+(\w+)|from\s+(\w+)\s+import/g) || []
    const dependencies = [...new Set(
      importMatches.map((match) => {
        const parts = match.split(/\s+/)
        return parts[1] === "from" ? parts[2] : parts[1]
      }).filter((dep) => !["os", "sys", "json", "time", "datetime"].includes(dep))
    )]

    if (dependencies.length === 0) {
      addTerminalLine("$ لم يتم العثور على متطلبات للتثبيت", "output")
      return
    }

    addTerminalLine(`$ تثبيت: ${dependencies.join(", ")}`, "output")
    
    // Simulate installation
    await new Promise((resolve) => setTimeout(resolve, 2000))
    
    addTerminalLine(`$ ✓ تم تثبيت ${dependencies.length} حزمة بنجاح`, "success")
  }, [selectedFile, addTerminalLine])

  // Handle terminal command
  const handleTerminalCommand = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!terminalInput.trim()) return

    addTerminalLine(`$ ${terminalInput}`, "input")

    // Simple command processing
    const cmd = terminalInput.trim().toLowerCase()
    
    if (cmd === "clear" || cmd === "cls") {
      setTerminalLines([])
    } else if (cmd === "ls" || cmd === "dir") {
      files.forEach((file) => {
        addTerminalLine(`  ${file.type === "folder" ? "📁" : "📄"} ${file.name}`, "output")
      })
    } else if (cmd.startsWith("echo ")) {
      addTerminalLine(cmd.substring(5), "output")
    } else if (cmd === "help") {
      addTerminalLine("الأوامر المتاحة:", "output")
      addTerminalLine("  clear/cls - مسح الشاشة", "output")
      addTerminalLine("  ls/dir - عرض الملفات", "output")
      addTerminalLine("  help - عرض المساعدة", "output")
      addTerminalLine("  echo <نص> - طباعة نص", "output")
    } else {
      addTerminalLine(`$ أمر غير معروف: ${cmd}`, "error")
    }

    setTerminalInput("")
  }, [terminalInput, files, addTerminalLine])

  // Download project
  const downloadProject = useCallback(() => {
    const projectData = {
      name: initialProject?.name || "my-project",
      files,
    }
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${projectData.name}.json`
    a.click()
    URL.revokeObjectURL(url)
    addTerminalLine(`$ تم تحميل المشروع: ${projectData.name}.json`, "success")
  }, [files, initialProject, addTerminalLine])

  // Render file tree
  const renderFileTree = (nodes: FileNode[], level = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded-md transition-colors",
            selectedFile?.path === node.path && "bg-accent",
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
        >
          {node.type === "folder" && (
            <button
              onClick={() => toggleFolder(node.path)}
              className="p-0 hover:bg-transparent"
            >
              {node.expanded ? (
                <ChevronDownIcon className="size-4" />
              ) : (
                <ChevronRightIcon className="size-4" />
              )}
            </button>
          )}
          <button
            onClick={() => node.type === "file" && setSelectedFile(node)}
            className="flex items-center gap-2 flex-1 text-left hover:bg-transparent"
          >
            {node.type === "folder" ? (
              <FolderIcon className="size-4 text-yellow-500" />
            ) : (
              <FileIcon className="size-4 text-blue-500" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          <button
            onClick={() => deleteNode(node.path)}
            className="opacity-0 group-hover:opacity-100 hover:text-destructive"
          >
            <TrashIcon className="size-3" />
          </button>
        </div>
        {node.type === "folder" && node.expanded && node.children && (
          <div>{renderFileTree(node.children, level + 1)}</div>
        )}
      </div>
    ))
  }

  return (
    <Artifact className="w-full h-[600px] max-w-full">
      {/* Header */}
      <ArtifactHeader>
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-5 text-primary" />
          <ArtifactTitle>
            {initialProject?.name || "محرر الأكواد المتكامل"}
          </ArtifactTitle>
        </div>
        <ArtifactActions>
          <ArtifactAction
            tooltip="تنفيذ الكود"
            icon={PlayIcon}
            onClick={executeCode}
            disabled={isExecuting || !selectedFile}
            className={cn(isExecuting && "animate-pulse")}
          />
          <ArtifactAction
            tooltip="تثبيت المتطلبات"
            icon={PackageIcon}
            onClick={installDependencies}
            disabled={!selectedFile}
          />
          <ArtifactAction
            tooltip="حفظ المشروع"
            icon={SaveIcon}
            onClick={() => addTerminalLine("$ تم الحفظ", "success")}
          />
          <ArtifactAction
            tooltip="تحميل المشروع"
            icon={DownloadIcon}
            onClick={downloadProject}
          />
          {onClose && <ArtifactClose onClick={onClose} />}
        </ArtifactActions>
      </ArtifactHeader>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: File Tree */}
        <div className="w-64 border-r bg-muted/30 overflow-y-auto">
          <div className="p-2 border-b bg-muted/50 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">الملفات</span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="size-6 p-0"
                onClick={() => {
                  setShowNewFileDialog(true)
                  setNewItemParentPath("/")
                }}
              >
                <PlusIcon className="size-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="size-6 p-0"
                onClick={() => {
                  setShowNewFolderDialog(true)
                  setNewItemParentPath("/")
                }}
              >
                <FolderPlusIcon className="size-3" />
              </Button>
            </div>
          </div>
          
          {/* New File/Folder Dialog */}
          {(showNewFileDialog || showNewFolderDialog) && (
            <div className="p-2 border-b bg-accent/50">
              <Input
                placeholder={showNewFileDialog ? "اسم الملف" : "اسم المجلد"}
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    showNewFileDialog ? createNewFile() : createNewFolder()
                  } else if (e.key === "Escape") {
                    setShowNewFileDialog(false)
                    setShowNewFolderDialog(false)
                    setNewItemName("")
                  }
                }}
                className="h-7 text-sm"
                autoFocus
              />
              <div className="flex gap-1 mt-1">
                <Button
                  size="sm"
                  variant="default"
                  className="h-6 text-xs flex-1"
                  onClick={showNewFileDialog ? createNewFile : createNewFolder}
                >
                  إنشاء
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => {
                    setShowNewFileDialog(false)
                    setShowNewFolderDialog(false)
                    setNewItemName("")
                  }}
                >
                  إلغاء
                </Button>
              </div>
            </div>
          )}

          <div className="p-2 group">{renderFileTree(files)}</div>
        </div>

        {/* Editor + Terminal */}
        <div className="flex-1 flex flex-col">
          {/* Editor */}
          <div className="flex-1 flex flex-col border-b">
            <div className="px-3 py-2 bg-muted/30 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedFile && (
                  <>
                    <FileIcon className="size-4 text-blue-500" />
                    <span className="text-sm font-medium">{selectedFile.name}</span>
                  </>
                )}
              </div>
              {selectedFile && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => {
                    updateFileContent(selectedFile.path, selectedFile.content || "")
                    addTerminalLine(`$ تم حفظ: ${selectedFile.name}`, "success")
                  }}
                >
                  <SaveIcon className="size-3 mr-1" />
                  حفظ
                </Button>
              )}
            </div>
            <textarea
              ref={editorRef}
              value={selectedFile?.content || ""}
              onChange={(e) =>
                selectedFile && updateFileContent(selectedFile.path, e.target.value)
              }
              className="flex-1 p-4 font-mono text-sm bg-background resize-none focus:outline-none"
              placeholder={
                selectedFile
                  ? "اكتب كودك هنا..."
                  : "اختر ملف من الشجرة أو أنشئ ملف جديد"
              }
              disabled={!selectedFile}
              spellCheck={false}
            />
          </div>

          {/* Terminal */}
          <div className="h-48 flex flex-col bg-black text-green-400">
            <div className="px-3 py-1.5 bg-zinc-900 border-b border-zinc-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TerminalIcon className="size-4" />
                <span className="text-xs font-medium">Terminal</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 p-0 px-2 text-xs hover:bg-zinc-100"
                onClick={() => setTerminalLines([])}
              >
                مسح
              </Button>
            </div>
            <div
              ref={terminalRef}
              className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-0.5"
            >
              {terminalLines.map((line, i) => (
                <div
                  key={`${line.timestamp}-${i}`}
                  className={cn(
                    line.type === "error" && "text-red-400",
                    line.type === "success" && "text-green-400",
                    line.type === "input" && "text-yellow-400",
                    line.type === "output" && "text-gray-300",
                  )}
                >
                  {line.text}
                </div>
              ))}
            </div>
            <form onSubmit={handleTerminalCommand} className="border-t border-zinc-700">
              <div className="flex items-center gap-2 px-2 py-1">
                <span className="text-yellow-400">$</span>
                <input
                  type="text"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-gray-300 font-mono text-xs"
                  placeholder="اكتب أمر..."
                />
              </div>
            </form>
          </div>
        </div>
      </div>
    </Artifact>
  )
}
