/**
 * @/kit — the ONLY place UI primitives live (ARCHITECTURE.md §9). Pages compose these; they never
 * re-implement a button, row, menu or dialog. Import from '@/kit', not from the individual files.
 */
import './kit.css'

export { cn } from './cn'
export { ICON_SIZE, ICON_STROKE, iconProps, type IconComponent } from './icon'

// actions
export { Button, buttonVariants, type ButtonProps } from './Button'
export { IconButton, iconButtonVariants, type IconButtonProps } from './IconButton'

// selection controls
export { Toggle, type ToggleProps } from './Toggle'
export { Checkbox, type CheckboxProps, type CheckedState } from './Checkbox'
export { Radio, RadioGroup, type RadioProps, type RadioGroupProps } from './Radio'
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './SegmentedControl'
export { Select, type SelectProps, type SelectOption, type SelectFooterAction } from './Select'

// text input
export { Input, type InputProps } from './Input'
export { Textarea, type TextareaProps } from './Textarea'
export { SearchBox, type SearchBoxProps } from './SearchBox'
export { FieldLabel, type FieldLabelProps } from './FieldLabel'

// feedback
export { Badge, badgeVariants, type BadgeProps } from './Badge'
export { Chip, type ChipProps } from './Chip'
export { InlineHint, type InlineHintProps, type InlineHintKind } from './InlineHint'
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner'
export { ProgressBar, type ProgressBarProps } from './ProgressBar'
export { Skeleton, SkeletonListRows, type SkeletonProps, type SkeletonListRowsProps } from './Skeleton'
export { EmptyState, type EmptyStateProps, type EmptyStateVariant, type EmptyStateAction } from './EmptyState'
export { Toaster, type ToasterProps } from './toast/Toaster'
export { ToastView, type ToastViewProps } from './toast/ToastView'
export {
  toast,
  addToast,
  updateToast,
  dismissToast,
  clearToasts,
  pauseToast,
  resumeToast,
  getToasts,
  subscribeToasts,
  TOAST_DEFAULT_DURATION,
  TOAST_MAX_VISIBLE,
  type ToastKind,
  type ToastInput,
  type ToastItem,
  type ToastAction,
} from './toast/toastStore'

// floating layers
export { Tooltip, TooltipProvider, type TooltipProps, type TooltipProviderProps } from './Tooltip'
export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent, type PopoverContentProps } from './Popover'
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItems,
  type DropdownMenuItemProps,
  type DropdownMenuCheckboxItemProps,
  type DropdownMenuRadioItemProps,
  type DropdownMenuSubTriggerProps,
} from './menu/DropdownMenu'
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioGroup,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuGroup,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuItems,
  type ContextMenuItemProps,
  type ContextMenuCheckboxItemProps,
  type ContextMenuSubTriggerProps,
} from './menu/ContextMenu'
export type { MenuSpec, MenuSpecItem } from './menu/menuSpec'
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps,
  type DialogHeaderProps,
  type DialogTone,
} from './Dialog'
export {
  ConfirmDialog,
  DangerDialog,
  FormDialog,
  FormDialogField,
  ProgressDialog,
  type ConfirmDialogProps,
  type DangerDialogProps,
  type FormDialogProps,
  type FormDialogFieldProps,
  type ProgressDialogProps,
  type ProgressStep,
  type ProgressStepStatus,
} from './DialogVariants'
export { Drawer, type DrawerProps } from './Drawer'

// structure
export { Avatar, avatarInitial, avatarTileIndex, type AvatarProps, type AvatarSize, type AvatarMember } from './Avatar'
export { ListItem, type ListItemProps } from './ListItem'
export { SettingRow, type SettingRowProps } from './SettingRow'
export { Tab, type TabProps } from './Tab'
export { Card, type CardProps } from './Card'
export { Kbd, type KbdProps } from './Kbd'
export { Divider, type DividerProps } from './Divider'
export { ScrollArea, type ScrollAreaProps } from './ScrollArea'
