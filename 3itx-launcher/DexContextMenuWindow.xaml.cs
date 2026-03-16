using System;
using System.Collections.Generic;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace _3itx_launcher;

public partial class DexContextMenuWindow : Window
{
    private DexContextMenuWindow? _subMenu;
    private readonly Action<string, string?>? _onAction;
    private readonly string _dataPath;
    private bool _showingSubMenu;

    public DexContextMenuWindow(
        double screenX,
        double screenY,
        List<ContextMenuItemData> items,
        Action<string, string?> onAction,
        string dataPath)
    {
        InitializeComponent();
        _onAction = onAction;
        _dataPath = dataPath;

        Left = screenX;
        Top = screenY;

        // Close submenu whenever mouse enters the main menu area
        MenuStack.MouseEnter += (_, _) =>
        {
            // Don't close if entering the Insert Object button itself
            if (_subMenu != null && !_showingSubMenu)
            {
                _subMenu.Close();
                _subMenu = null;
                _showingSubMenu = false;
            }
        };

        foreach (var item in items)
        {
            if (item.Separator)
            {
                MenuStack.Children.Add(new Border
                {
                    Height = 1,
                    Background = new SolidColorBrush(Color.FromArgb(0x0F, 0xFF, 0xFF, 0xFF)),
                    Margin = new Thickness(8, 2, 8, 2)
                });
                continue;
            }

            var btn = CreateMenuButton(item.Label, item.Icon, item.Danger, item.SubItems != null, item.Shortcut);

            if (item.SubItems != null)
            {
                var subItems = item.SubItems;
                btn.MouseEnter += (_, _) =>
                {
                    _showingSubMenu = true;
                    ShowSubMenu(btn, subItems);
                };
                btn.MouseLeave += (_, _) =>
                {
                    _showingSubMenu = false;
                    // Delayed close: give time to move into submenu
                    var subRef = _subMenu;
                    Task.Delay(200).ContinueWith(_ =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (_subMenu == subRef && _subMenu != null && !_subMenu.IsMouseOver && !btn.IsMouseOver)
                            {
                                _subMenu.Close();
                                _subMenu = null;
                            }
                        });
                    });
                };
            }
            else if (item.Disabled)
            {
                btn.IsEnabled = false;
                btn.Opacity = 0.35;
                // Even disabled items should close any open submenu on hover
                btn.MouseEnter += (_, _) =>
                {
                    if (_subMenu != null)
                    {
                        _subMenu.Close();
                        _subMenu = null;
                        _showingSubMenu = false;
                    }
                };
            }
            else
            {
                var actionId = item.ActionId;
                // Close any open submenu when hovering over non-submenu items
                btn.MouseEnter += (_, _) =>
                {
                    if (_subMenu != null)
                    {
                        _subMenu.Close();
                        _subMenu = null;
                        _showingSubMenu = false;
                    }
                };
                btn.Click += (_, _) =>
                {
                    _onAction?.Invoke(actionId, null);
                    CloseAll();
                };
            }

            MenuStack.Children.Add(btn);
        }
    }

    /// <summary>
    /// Creates the Insert Object submenu popup window
    /// </summary>
    public static DexContextMenuWindow CreateInsertMenu(
        double screenX,
        double screenY,
        Action<string, string?> onAction,
        string dataPath)
    {
        var win = new DexContextMenuWindow();
        win._subMenu = null;
        win.Left = screenX;
        win.Top = screenY;
        win.Width = 180;
        win.SizeToContent = SizeToContent.Height;
        win.MaxHeight = 400;

        var stack = win.MenuStack;
        stack.MinWidth = 178;

        // Search box
        var searchBox = new TextBox
        {
            Height = 20,
            FontSize = 10,
            FontFamily = new FontFamily("Segoe UI"),
            Foreground = new SolidColorBrush(Color.FromArgb(0xB3, 0xFF, 0xFF, 0xFF)),
            Background = new SolidColorBrush(Color.FromArgb(0x0A, 0xFF, 0xFF, 0xFF)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(0x0F, 0xFF, 0xFF, 0xFF)),
            BorderThickness = new Thickness(1),
            Margin = new Thickness(6, 6, 6, 4),
            Padding = new Thickness(4, 2, 4, 2),
            CaretBrush = new SolidColorBrush(Colors.White),
        };
        // Placeholder text
        searchBox.Tag = "Search class...";
        searchBox.Text = "Search class...";
        searchBox.Foreground = new SolidColorBrush(Color.FromArgb(0x33, 0xFF, 0xFF, 0xFF));
        searchBox.GotFocus += (_, _) =>
        {
            if (searchBox.Text == (string)searchBox.Tag)
            {
                searchBox.Text = "";
                searchBox.Foreground = new SolidColorBrush(Color.FromArgb(0xB3, 0xFF, 0xFF, 0xFF));
            }
        };
        searchBox.LostFocus += (_, _) =>
        {
            if (string.IsNullOrEmpty(searchBox.Text))
            {
                searchBox.Text = (string)searchBox.Tag;
                searchBox.Foreground = new SolidColorBrush(Color.FromArgb(0x33, 0xFF, 0xFF, 0xFF));
            }
        };
        stack.Children.Add(searchBox);

        stack.Children.Add(new Border
        {
            Height = 1,
            Background = new SolidColorBrush(Color.FromArgb(0x0F, 0xFF, 0xFF, 0xFF)),
            Margin = new Thickness(0, 2, 0, 2)
        });

        // Scrollable class list
        var scrollViewer = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            MaxHeight = 340,
        };
        var classStack = new StackPanel();

        var iconsDir = Path.Combine(dataPath, "DexIcons", "Instances");

        foreach (var (category, classes) in InsertableCategories)
        {
            // Category header
            classStack.Children.Add(new TextBlock
            {
                Text = category.ToUpperInvariant(),
                FontFamily = new FontFamily("Segoe UI"),
                FontSize = 8,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF)),
                Margin = new Thickness(8, 6, 8, 2),
                Tag = "__header__",
            });

            foreach (var cls in classes)
            {
                var classBtn = CreateClassButton(cls, iconsDir);
                classBtn.Tag = cls; // ensure tag is set for filtering
                var clsName = cls;
                classBtn.Click += (_, _) =>
                {
                    onAction("insertObject", clsName);
                    win.Close();
                };
                classStack.Children.Add(classBtn);
            }
        }

        scrollViewer.Content = classStack;
        stack.Children.Add(scrollViewer);

        // Filter logic
        searchBox.TextChanged += (_, _) =>
        {
            var filter = searchBox.Text;
            if (filter == (string)searchBox.Tag) filter = "";
            foreach (var child in classStack.Children)
            {
                if (child is Button b && b.Tag is string name)
                {
                    b.Visibility = string.IsNullOrEmpty(filter) ||
                                   name.Contains(filter, StringComparison.OrdinalIgnoreCase)
                        ? Visibility.Visible
                        : Visibility.Collapsed;
                }
                else if (child is TextBlock header && header.Tag is string headerTag && headerTag == "__header__")
                {
                    // Show/hide category headers based on whether any of their children are visible
                    // Simple approach: hide all headers when filtering
                    header.Visibility = string.IsNullOrEmpty(filter) ? Visibility.Visible : Visibility.Collapsed;
                }
            }
        };

        return win;
    }

    // Private constructor for submenu factory
    private DexContextMenuWindow()
    {
        InitializeComponent();
        _dataPath = "";
    }

    private void ShowSubMenu(Button parentBtn, List<ContextMenuItemData> subItems)
    {
        _subMenu?.Close();

        _showingSubMenu = true;
        var pos = parentBtn.PointToScreen(new Point(parentBtn.ActualWidth, 0));
        _subMenu = CreateInsertMenu(pos.X + 2, pos.Y, _onAction!, _dataPath);
        _subMenu.Owner = this;

        // When mouse leaves the submenu, close it after a short delay
        _subMenu.MouseLeave += (_, _) =>
        {
            var subRef = _subMenu;
            Task.Delay(150).ContinueWith(_ =>
            {
                Dispatcher.Invoke(() =>
                {
                    if (_subMenu == subRef && _subMenu != null && !_subMenu.IsMouseOver)
                    {
                        _subMenu.Close();
                        _subMenu = null;
                        _showingSubMenu = false;
                    }
                });
            });
        };

        _subMenu.Closed += (_, _) =>
        {
            _subMenu = null;
            _showingSubMenu = false;
        };

        _subMenu.Show();
    }

    private static Style FlatButtonStyle()
    {
        var style = new Style(typeof(Button));
        var template = new ControlTemplate(typeof(Button));
        var border = new FrameworkElementFactory(typeof(Border));
        border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
        border.SetBinding(Border.PaddingProperty, new System.Windows.Data.Binding("Padding") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
        var presenter = new FrameworkElementFactory(typeof(ContentPresenter));
        presenter.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Stretch);
        presenter.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        border.AppendChild(presenter);
        template.VisualTree = border;
        style.Setters.Add(new Setter(Control.TemplateProperty, template));
        style.Setters.Add(new Setter(Control.BackgroundProperty, Brushes.Transparent));
        style.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(0)));
        style.Setters.Add(new Setter(FrameworkElement.CursorProperty, Cursors.Arrow));
        return style;
    }

    private static Button CreateMenuButton(string label, string? icon, bool danger, bool hasArrow, string? shortcut = null)
    {
        var btn = new Button
        {
            Style = FlatButtonStyle(),
            Height = 28,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(12, 0, 12, 0),
        };

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Icon
        if (!string.IsNullOrEmpty(icon))
        {
            var iconBlock = new TextBlock
            {
                Text = icon,
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 12,
                Foreground = danger
                    ? new SolidColorBrush(Color.FromRgb(0xF8, 0x71, 0x71))
                    : new SolidColorBrush(Color.FromArgb(0x66, 0xFF, 0xFF, 0xFF)),
                VerticalAlignment = VerticalAlignment.Center,
                Width = 14,
                TextAlignment = TextAlignment.Center,
                Margin = new Thickness(0, 0, 6, 0),
            };
            Grid.SetColumn(iconBlock, 0);
            grid.Children.Add(iconBlock);
        }

        var text = new TextBlock
        {
            Text = label,
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = 11,
            Foreground = danger
                ? new SolidColorBrush(Color.FromRgb(0xF8, 0x71, 0x71))
                : new SolidColorBrush(Color.FromArgb(0x99, 0xFF, 0xFF, 0xFF)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        // Shortcut label or arrow
        if (hasArrow)
        {
            var arrow = new TextBlock
            {
                Text = "\u25B8",
                FontSize = 11,
                Foreground = new SolidColorBrush(Color.FromArgb(0x66, 0xFF, 0xFF, 0xFF)),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 0, 0),
            };
            Grid.SetColumn(arrow, 2);
            grid.Children.Add(arrow);
        }
        else if (!string.IsNullOrEmpty(shortcut))
        {
            var shortcutBlock = new TextBlock
            {
                Text = shortcut,
                FontFamily = new FontFamily("Segoe UI"),
                FontSize = 9,
                Foreground = new SolidColorBrush(Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF)),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(16, 0, 0, 0),
            };
            Grid.SetColumn(shortcutBlock, 2);
            grid.Children.Add(shortcutBlock);
        }

        btn.Content = grid;

        // Hover style — transparent white
        btn.MouseEnter += (_, _) =>
            btn.Background = new SolidColorBrush(Color.FromArgb(0x18, 0xFF, 0xFF, 0xFF));
        btn.MouseLeave += (_, _) =>
            btn.Background = Brushes.Transparent;

        return btn;
    }

    private static Button CreateClassButton(string className, string iconsDir)
    {
        var btn = new Button
        {
            Tag = className,
            Style = FlatButtonStyle(),
            Height = 22,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(8, 0, 8, 0),
        };

        var sp = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Try to load icon
        var iconPath = Path.Combine(iconsDir, className + ".png");
        if (File.Exists(iconPath))
        {
            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.UriSource = new Uri(iconPath, UriKind.Absolute);
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.EndInit();
                bmp.Freeze();
                sp.Children.Add(new Image
                {
                    Source = bmp,
                    Width = 14,
                    Height = 14,
                    Margin = new Thickness(0, 0, 6, 0),
                });
            }
            catch { }
        }

        sp.Children.Add(new TextBlock
        {
            Text = className,
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = 10,
            Foreground = new SolidColorBrush(Color.FromArgb(0x99, 0xFF, 0xFF, 0xFF)),
            VerticalAlignment = VerticalAlignment.Center,
        });

        btn.Content = sp;

        btn.MouseEnter += (_, _) =>
            btn.Background = new SolidColorBrush(Color.FromArgb(0x18, 0xFF, 0xFF, 0xFF));
        btn.MouseLeave += (_, _) =>
            btn.Background = Brushes.Transparent;

        return btn;
    }

    private void CloseAll()
    {
        _subMenu?.Close();
        _subMenu = null;
        Close();
    }

    private void Window_Deactivated(object sender, EventArgs e)
    {
        // Don't close if submenu is open or being shown
        if (_showingSubMenu || _subMenu?.IsActive == true) return;
        CloseAll();
    }

    public static readonly (string Category, string[] Classes)[] InsertableCategories =
    {
        ("Parts", new[] { "Part", "WedgePart", "MeshPart", "TrussPart", "CornerWedgePart", "SpawnLocation" }),
        ("Organization", new[] { "Model", "Folder", "Configuration" }),
        ("Scripting", new[] { "Script", "LocalScript", "ModuleScript" }),
        ("GUI", new[] { "Frame", "TextLabel", "TextButton", "TextBox", "ImageLabel", "ImageButton", "ScrollingFrame", "ViewportFrame" }),
        ("Layout", new[] { "UIListLayout", "UIGridLayout", "UITableLayout", "UIPadding", "UICorner", "UIStroke", "UIScale", "UIAspectRatioConstraint", "UISizeConstraint" }),
        ("3D GUI", new[] { "ScreenGui", "SurfaceGui", "BillboardGui" }),
        ("Seating", new[] { "Seat", "VehicleSeat" }),
        ("Lighting", new[] { "PointLight", "SpotLight", "SurfaceLight" }),
        ("Effects", new[] { "Fire", "Smoke", "Sparkles", "ParticleEmitter", "Trail", "Beam" }),
        ("Physics", new[] { "BodyForce", "BodyVelocity", "BodyPosition", "BodyGyro" }),
        ("Interaction", new[] { "ClickDetector", "ProximityPrompt", "Attachment" }),
        ("Audio", new[] { "Sound", "SoundGroup" }),
        ("Networking", new[] { "RemoteEvent", "RemoteFunction", "BindableEvent", "BindableFunction" }),
        ("Values", new[] { "BoolValue", "IntValue", "NumberValue", "StringValue", "ObjectValue", "Color3Value", "BrickColorValue" }),
        ("Constraints", new[] { "Weld", "WeldConstraint", "Motor6D", "HingeConstraint", "RopeConstraint", "SpringConstraint" }),
        ("Visuals", new[] { "Camera", "Decal", "Texture", "SurfaceAppearance" }),
        ("Animation", new[] { "Animation", "AnimationController", "Animator" }),
        ("Avatar", new[] { "Humanoid", "HumanoidDescription", "Shirt", "Pants", "ShirtGraphic", "BodyColors", "Accessory", "Hat" }),
        ("Tools", new[] { "Tool", "Backpack" }),
        ("Operations", new[] { "UnionOperation", "NegateOperation" }),
    };
}

public class ContextMenuItemData
{
    public string Label { get; set; } = "";
    public string ActionId { get; set; } = "";
    public string? Icon { get; set; }
    public string? Shortcut { get; set; }
    public bool Disabled { get; set; }
    public bool Danger { get; set; }
    public bool Separator { get; set; }
    public List<ContextMenuItemData>? SubItems { get; set; }
}
