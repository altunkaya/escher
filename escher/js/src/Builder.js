define(['utils', 'BuildInput', 'ZoomContainer', 'Map', 'CobraModel', 'Brush', 'CallbackManager', 'ui', 'SearchBar', 'Settings', 'SettingsMenu', 'TextEditInput', 'QuickJump', 'data_styles'], function(utils, BuildInput, ZoomContainer, Map, CobraModel, Brush, CallbackManager, ui, SearchBar, Settings, SettingsMenu, TextEditInput, QuickJump, data_styles) {
    /** For documentation of this class, see docs/javascript_api.rst

     */
    var Builder = utils.make_class();
    Builder.prototype = { init: init,
                          load_map: load_map,
                          load_model: load_model,
                          _set_mode: _set_mode,
                          view_mode: view_mode,
                          build_mode: build_mode,
                          brush_mode: brush_mode,
                          zoom_mode: zoom_mode,
                          rotate_mode: rotate_mode,
                          text_mode: text_mode,
                          set_reaction_data: set_reaction_data,
                          set_metabolite_data: set_metabolite_data,
                          set_gene_data: set_gene_data,
                          _update_data: _update_data,
                          _toggle_direction_buttons: _toggle_direction_buttons,
                          _setup_menu: _setup_menu,
                          _setup_simple_zoom_buttons: _setup_simple_zoom_buttons,
                          _setup_status: _setup_status,
                          _setup_quick_jump: _setup_quick_jump,
                          _setup_modes: _setup_modes,
                          _get_keys: _get_keys,
                          _setup_confirm_before_exit: _setup_confirm_before_exit };

    return Builder;

    // definitions
    function init(map_data, model_data, embedded_css, selection, options) {

        // default sel
        if (!selection)
            selection = d3.select('body').append('div');
        if (!options)
            options = {};

        this.map_data = map_data;
        this.model_data = model_data;
        this.embedded_css = embedded_css;
        this.selection = selection;

        // apply this object as data for the selection
        this.selection.datum(this);

        // set defaults
        this.options = utils.set_options(options, {
            // view options
            menu: 'all',
            scroll_behavior: 'pan',
            use_3d_transform: false,
            enable_editing: true,
            enable_keys: true,
            enable_search: true,
            fill_screen: false,
            zoom_to_element: null,
            full_screen_button: false,
            // map, model, and styles
            starting_reaction: null,
            never_ask_before_quit: false,
            unique_map_id: null,
            primary_metabolite_radius: 20,
            secondary_metabolite_radius: 10,
            marker_radius: 5,
            gene_font_size: 18,
            hide_secondary_metabolites: false,
            show_gene_reaction_rules: false,
            hide_all_labels: false,
            // applied data
            // reaction
            reaction_data: null,
            reaction_styles: ['color', 'size', 'text'],
            reaction_compare_style: 'log2_fold',
            reaction_scale: [{ type: 'min', color: '#c8c8c8', size: 12 },
                             { type: 'median', color: '#9696ff', size: 20 },
                             { type: 'max', color: '#ff0000', size: 25 }],
            reaction_no_data_color: '#dcdcdc',
            reaction_no_data_size: 8,
            // gene
            gene_data: null,
            and_method_in_gene_reaction_rule: 'mean',
            // metabolite
            metabolite_data: null,
            metabolite_styles: ['color', 'size', 'text'],
            metabolite_compare_style: 'log2_fold',
            metabolite_scale: [ { type: 'min', color: '#fffaf0', size: 20 },
                                { type: 'median', color: '#f1c470', size: 30 },
                                { type: 'max', color: '#800000', size: 40 } ],
            metabolite_no_data_color: '#ffffff',
            metabolite_no_data_size: 10,
            // View and build options
            identifiers_on_map: 'bigg_id',
            highlight_missing: false,
            allow_building_duplicate_reactions: false,
            // Callbacks
            first_load_callback: null
        }, {
            primary_metabolite_radius: true,
            secondary_metabolite_radius: true,
            marker_radius: true,
            gene_font_size: true,
            reaction_no_data_size: true,
            metabolite_no_data_size: true
        });

        // check the location
        if (utils.check_for_parent_tag(this.selection, 'svg')) {
            throw new Error('Builder cannot be placed within an svg node '+
                            'becuase UI elements are html-based.');
        }

        // Initialize the settings
        var set_option = function(option, new_value) {
            this.options[option] = new_value;
        }.bind(this),
            get_option = function(option) {
                return this.options[option];
            }.bind(this),
            // the options that are erased when the settings menu is canceled
            conditional_options = ['hide_secondary_metabolites', 'show_gene_reaction_rules',
                                   'hide_all_labels', 'scroll_behavior', 'use_3d_transform', 'reaction_styles',
                                   'reaction_compare_style', 'reaction_scale',
                                   'reaction_no_data_color', 'reaction_no_data_size',
                                   'and_method_in_gene_reaction_rule', 'metabolite_styles',
                                   'metabolite_compare_style', 'metabolite_scale',
                                   'metabolite_no_data_color', 'metabolite_no_data_size',
                                   'identifiers_on_map', 'highlight_missing',
                                   'allow_building_duplicate_reactions',];
        this.settings = new Settings(set_option, get_option, conditional_options);

        // check the scales have max and min
        ['reaction_scale', 'metabolite_scale'].forEach(function(name) {
            this.settings.streams[name].onValue(function(val) {
                ['min', 'max'].forEach(function(type) {
                    var has = val.reduce(function(has_found, scale_el) {
                        return has_found || (scale_el.type == type);
                    }, false);
                    if (!has) {
                        val.push({ type: type, color: '#ffffff', size: 10 });
                        this.settings.set_conditional(name, val);
                    }
                }.bind(this));
            }.bind(this));
        }.bind(this));
        // TODO warn about repeated types in the scale

        // set up this callback manager
        this.callback_manager = CallbackManager();
        if (this.options.first_load_callback !== null)
            this.callback_manager.set('first_load', this.options.first_load_callback);

        // load the model, map, and update data in both
        this.load_model(this.model_data, false);
        this.load_map(this.map_data, false);
        this._update_data(true, true);

        // setting callbacks
        // TODO enable atomic updates. Right now, every time
        // the menu closes, everything is drawn.
        this.settings.status_bus
            .onValue(function(x) {
                if (x === 'accepted') {
                    this._update_data(true, true, ['reaction', 'metabolite'], false);
                    if (this.zoom_container !== null) {
                        var new_behavior = this.settings.get_option('scroll_behavior');
                        this.zoom_container.set_scroll_behavior(new_behavior);
                        this.zoom_container.set_use_3d_transform(this.settings.get_option('use_3d_transform'));
                    }
                    if (this.map !== null) {
                        this.map.draw_all_nodes(false);
                        this.map.draw_all_reactions(true, false);
                    }
                }
            }.bind(this));

        this.callback_manager.run('first_load', this);
    }

    // Definitions
    function load_model(model_data, should_update_data) {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        if (should_update_data === undefined)
            should_update_data = true;

        // Check the cobra model
        if (model_data === null)
            this.cobra_model = null;
        else
            this.cobra_model = CobraModel.from_cobra_json(model_data);

        if (this.map) {
            this.map.cobra_model = this.cobra_model;
            if (should_update_data)
                this._update_data(true, false);
            if (this.settings.get_option('highlight_missing'))
                this.map.draw_all_reactions(false, false);
        }

        this.callback_manager.run('load_model', null, model_data, should_update_data);
    }

    function load_map(map_data, should_update_data) {
        /** For documentation of this function, see docs/javascript_api.rst

         */

        if (should_update_data === undefined)
            should_update_data = true;

        // Begin with some definitions
        var selectable_mousedown_enabled = true,
            shift_key_on = false;

        // remove the old builder
        utils.remove_child_nodes(this.selection);

        // set up the zoom container
        this.zoom_container = new ZoomContainer(this.selection,
                                                this.options.scroll_behavior,
                                                this.options.use_3d_transform,
                                                this.options.fill_screen);
        var zoomed_sel = this.zoom_container.zoomed_sel;
        var svg = this.zoom_container.svg;

        if (map_data!==null) {
            // import map
            this.map = Map.from_data(map_data,
                                     svg,
                                     this.embedded_css,
                                     zoomed_sel,
                                     this.zoom_container,
                                     this.settings,
                                     this.cobra_model,
                                     this.options.enable_search);
        } else {
            // new map
            this.map = new Map(svg,
                               this.embedded_css,
                               zoomed_sel,
                               this.zoom_container,
                               this.settings,
                               this.cobra_model,
                               null,
                               this.options.enable_search);
        }
        // zoom container status changes
        this.zoom_container.callback_manager.set('svg_start', function() {
            this.map.set_status('Drawing ...');
        }.bind(this));
        this.zoom_container.callback_manager.set('svg_finish', function() {
            this.map.set_status('');
        }.bind(this));

        // set the data for the map
        if (should_update_data)
            this._update_data(false, true);

        // set up the reaction input with complete.ly
        this.build_input = BuildInput(this.selection, this.map,
                                      this.zoom_container, this.settings);

        // set up the text edit input
        this.text_edit_input = TextEditInput(this.selection, this.map,
                                             this.zoom_container);

        // set up the Brush
        this.brush = new Brush(zoomed_sel, false, this.map, '.canvas-group');
        this.map.canvas.callback_manager.set('resize', function() {
            this.brush.toggle(true);
        }.bind(this));

        // set up the modes
        this._setup_modes(this.map, this.brush, this.zoom_container);

        var s = this.selection
                .append('div').attr('class', 'search-menu-container')
                .append('div').attr('class', 'search-menu-container-inline'),
            menu_div = s.append('div'),
            search_bar_div = s.append('div'),
            button_div = this.selection.append('div');

        // set up the search bar
        this.search_bar = SearchBar(search_bar_div, this.map.search_index,
                                    this.map);
        // set up the hide callbacks
        this.search_bar.callback_manager.set('show', function() {
            this.settings_bar.toggle(false);
        }.bind(this));

        // set up the settings
        var settings_div = this.selection.append('div');
        this.settings_bar = SettingsMenu(settings_div, this.settings, this.map,
                                         function(type, on_off) {
                                             // temporarily set the abs type, for
                                             // previewing it in the Settings
                                             // menu
                                             var o = this.options[type + '_styles'];
                                             if (on_off && o.indexOf('abs') == -1)
                                                 o.push('abs');
                                             else if (!on_off) {
                                                 var i = o.indexOf('abs');
                                                 if (i != -1)
                                                     this.options[type + '_styles'] = o.slice(0, i).concat(o.slice(i + 1));
                                             }
                                             this._update_data(false, true, type);
                                         }.bind(this));
        this.settings_bar.callback_manager.set('show', function() {
            this.search_bar.toggle(false);
        }.bind(this));

        // set up key manager
        var keys = this._get_keys(this.map, this.zoom_container,
                                  this.search_bar, this.settings_bar,
                                  this.options.enable_editing,
                                  this.options.full_screen_button);
        this.map.key_manager.assigned_keys = keys;
        // tell the key manager about the reaction input and search bar
        this.map.key_manager.input_list = [this.build_input, this.search_bar,
                                           this.settings_bar, this.text_edit_input];
        // make sure the key manager remembers all those changes
        this.map.key_manager.update();
        // turn it on/off
        this.map.key_manager.toggle(this.options.enable_keys);

        // set up menu and status bars
        if (this.options.menu=='all') {
            this._setup_menu(menu_div, button_div, this.map, this.zoom_container, this.map.key_manager, keys,
                             this.options.enable_editing, this.options.enable_keys, this.options.full_screen_button);
        } else if (this.options.menu=='zoom') {
            this._setup_simple_zoom_buttons(button_div, keys, this.options.full_screen_button);
        }

        // setup selection box
        if (this.options.zoom_to_element) {
            var type = this.options.zoom_to_element.type,
                element_id = this.options.zoom_to_element.id;
            if (typeof type === 'undefined' || ['reaction', 'node'].indexOf(type) == -1)
                throw new Error('zoom_to_element type must be "reaction" or "node"');
            if (typeof element_id === 'undefined')
                throw new Error('zoom_to_element must include id');
            if (type == 'reaction')
                this.map.zoom_to_reaction(element_id);
            else if (type == 'node')
                this.map.zoom_to_node(element_id);
        } else if (map_data !== null) {
            this.map.zoom_extent_canvas();
        } else {
            if (this.options.starting_reaction !== null && this.cobra_model !== null) {
                // Draw default reaction if no map is provided
                var size = this.zoom_container.get_size();
                var start_coords = { x: size.width / 2,
                                     y: size.height / 4 };
                this.map.new_reaction_from_scratch(this.options.starting_reaction, start_coords, 90);
                this.map.zoom_extent_nodes();
            } else {
                this.map.zoom_extent_canvas();
            }
        }

        // status in both modes
        var status = this._setup_status(this.selection, this.map);

        // set up quick jump
        this._setup_quick_jump(this.selection);

        // start in zoom mode for builder, view mode for viewer
        if (this.options.enable_editing)
            this.zoom_mode();
        else
            this.view_mode();

        // confirm before leaving the page
        if (this.options.enable_editing)
            this._setup_confirm_before_exit();

        // draw
        this.map.draw_everything();
    }

    function _set_mode(mode) {
        this.search_bar.toggle(false);
        // input
        this.build_input.toggle(mode=='build');
        this.build_input.direction_arrow.toggle(mode=='build');
        if (this.options.menu=='all' && this.options.enable_editing)
            this._toggle_direction_buttons(mode=='build');
        // brush
        this.brush.toggle(mode=='brush');
        // zoom
        this.zoom_container.toggle_pan_drag(mode=='zoom' || mode=='view');
        // resize canvas
        this.map.canvas.toggle_resize(mode=='zoom' || mode=='brush');
        // Behavior. Be careful of the order becuase rotation and
        // toggle_selectable_drag both use Behavior.selectable_drag.
        if (mode == 'rotate') {
            this.map.behavior.toggle_selectable_drag(false); // before toggle_rotation_mode
            this.map.behavior.toggle_rotation_mode(true);
        } else {
            this.map.behavior.toggle_rotation_mode(mode=='rotate'); // before toggle_selectable_drag
            this.map.behavior.toggle_selectable_drag(mode=='brush');
        }
        this.map.behavior.toggle_selectable_click(mode=='build' || mode=='brush');
        this.map.behavior.toggle_label_drag(mode=='brush');
        this.map.behavior.toggle_label_mousedown(mode=='brush');
        this.map.behavior.toggle_text_label_edit(mode=='text');
        this.map.behavior.toggle_bezier_drag(mode=='brush');
        // edit selections
        if (mode=='view' || mode=='text')
            this.map.select_none();
        if (mode=='rotate')
            this.map.deselect_text_labels();
        this.map.draw_everything();
    }

    function view_mode() {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        this.callback_manager.run('view_mode');
        this._set_mode('view');
    }

    function build_mode() {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        this.callback_manager.run('build_mode');
        this._set_mode('build');
    }

    function brush_mode() {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        this.callback_manager.run('brush_mode');
        this._set_mode('brush');
    }

    function zoom_mode() {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        this.callback_manager.run('zoom_mode');
        this._set_mode('zoom');
    }

    function rotate_mode() {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        this.callback_manager.run('rotate_mode');
        this._set_mode('rotate');
    }

    function text_mode() {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        this.callback_manager.run('text_mode');
        this._set_mode('text');
    }

    function set_reaction_data(data) {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        this.options.reaction_data = data;
        this._update_data(true, true, 'reaction');
        this.map.set_status('');
    }

    function set_gene_data(data, clear_gene_reaction_rules) {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        if (clear_gene_reaction_rules) // default undefined
            this.settings.set_conditional('show_gene_reaction_rules', false);
        this.options.gene_data = data;
        this._update_data(true, true, 'reaction');
        this.map.set_status('');
    }

    function set_metabolite_data(data) {
        /** For documentation of this function, see docs/javascript_api.rst.

         */
        this.options.metabolite_data = data;
        this._update_data(true, true, 'metabolite');
        this.map.set_status('');
    }

    function _update_data(update_model, update_map, kind, should_draw) {
        /** Set data and settings for the model.

         Arguments
         ---------

         update_model: (Boolean) Update data for the model.

         update_map: (Boolean) Update data for the map.

         kind: (Optional, Default: all) An array defining which data is being
         updated that can include any of: ['reaction', 'metabolite'].

         should_draw: (Optional, Default: true) Whether to redraw the update
         sections of the map.

         */

        // defaults
        if (kind === undefined)
            kind = ['reaction', 'metabolite'];
        if (should_draw === undefined)
            should_draw = true;

        var update_metabolite_data = (kind.indexOf('metabolite') != -1),
            update_reaction_data = (kind.indexOf('reaction') != -1),
            met_data_object,
            reaction_data_object,
            gene_data_object;

        // -------------------
        // First map, and draw

        // metabolite data
        if (update_metabolite_data && update_map && this.map !== null) {
            met_data_object = data_styles.import_and_check(this.options.metabolite_data,
                                                           'metabolite_data');
            this.map.apply_metabolite_data_to_map(met_data_object);
            if (should_draw)
                this.map.draw_all_nodes(false);
        }

        // reaction data
        if (update_reaction_data) {
            if (this.options.reaction_data !== null && update_map && this.map !== null) {
                reaction_data_object = data_styles.import_and_check(this.options.reaction_data,
                                                                    'reaction_data');
                this.map.apply_reaction_data_to_map(reaction_data_object);
                if (should_draw)
                    this.map.draw_all_reactions(false, false);
            } else if (this.options.gene_data !== null && update_map && this.map !== null) {
                gene_data_object = make_gene_data_object(this.options.gene_data,
                                                         this.cobra_model, this.map);
                this.map.apply_gene_data_to_map(gene_data_object);
                if (should_draw)
                    this.map.draw_all_reactions(false, false);
            } else if (update_map && this.map !== null) {
                // clear the data
                this.map.apply_reaction_data_to_map(null);
                if (should_draw)
                    this.map.draw_all_reactions(false, false);
            }
        }

        // ----------------------------------------------------------------
        // Then the model, after drawing. Delay by 5ms so the the map draws
        // first.

        // if this function runs again, cancel the previous model update
        if (this.update_model_timer)
            window.clearTimeout(this.update_model_timer);

        var delay = 5;
        this.update_model_timer = window.setTimeout(function() {

            // metabolite_data
            if (update_metabolite_data && update_model && this.cobra_model !== null) {
                // if we haven't already made this
                if (!met_data_object)
                    met_data_object = data_styles.import_and_check(this.options.metabolite_data,
                                                                   'metabolite_data');
                this.cobra_model.apply_metabolite_data(met_data_object,
                                                       this.options.metabolite_styles,
                                                       this.options.metabolite_compare_style);
            }

            // reaction data
            if (update_reaction_data) {
                if (this.options.reaction_data !== null && update_model && this.cobra_model !== null) {
                    // if we haven't already made this
                    if (!reaction_data_object)
                        reaction_data_object = data_styles.import_and_check(this.options.reaction_data,
                                                                            'reaction_data');
                    this.cobra_model.apply_reaction_data(reaction_data_object,
                                                         this.options.reaction_styles,
                                                         this.options.reaction_compare_style);
                } else if (this.options.gene_data !== null && update_model && this.cobra_model !== null) {
                    if (!gene_data_object)
                        gene_data_object = make_gene_data_object(this.options.gene_data,
                                                                 this.cobra_model, this.map);
                    this.cobra_model.apply_gene_data(gene_data_object,
                                                     this.options.reaction_styles,
                                                     this.options.identifiers_on_map,
                                                     this.options.reaction_compare_style,
                                                     this.options.and_method_in_gene_reaction_rule);
                } else if (update_model && this.cobra_model !== null) {
                    // clear the data
                    this.cobra_model.apply_reaction_data(null,
                                                         this.options.reaction_styles,
                                                         this.options.reaction_compare_style);
                }
            }

            // callback
            this.callback_manager.run('update_data', null, update_model, update_map, kind, should_draw);

        }.bind(this), delay);

        // definitions
        function make_gene_data_object(gene_data, cobra_model, map) {
            var all_reactions = {};
            if (cobra_model !== null)
                utils.extend(all_reactions, cobra_model.reactions);
            // extend, overwrite
            if (map !== null)
                utils.extend(all_reactions, map.reactions, true);

            // this object has reaction keys and values containing associated genes
            return data_styles.import_and_check(gene_data, 'gene_data', all_reactions);
        }
    }

    function _setup_menu(menu_selection, button_selection, map, zoom_container,
                         key_manager, keys, enable_editing, enable_keys, full_screen_button) {
        var menu = menu_selection.attr('id', 'menu')
                .append('ul')
                .attr('class', 'nav nav-pills');
        // map dropdown
        ui.dropdown_menu(menu, 'Map')
            .button({ key: keys.save,
                      text: 'Save map JSON',
                      key_text: (enable_keys ? ' (Ctrl+S)' : null) })
            .button({ text: 'Load map JSON',
                      key_text: (enable_keys ? ' (Ctrl+O)' : null),
                      input: { assign: key_manager.assigned_keys.load,
                               key: 'fn',
                               fn: load_map_for_file.bind(this),
                               pre_fn: function() {
                                   map.set_status('Loading map ...');
                               },
                               failure_fn: function() {
                                   map.set_status('');
                               }}
                    })
            .button({ key: keys.save_svg,
                      text: 'Export as SVG',
                      key_text: (enable_keys ? ' (Ctrl+Shift+S)' : null) })
            .button({ key: keys.clear_map,
                      text: 'Clear map' });
        // model dropdown
        var model_menu = ui.dropdown_menu(menu, 'Model')
                .button({ text: 'Load COBRA model JSON',
                          key_text: (enable_keys ? ' (Ctrl+M)' : null),
                          input: { assign: key_manager.assigned_keys.load_model,
                                   key: 'fn',
                                   fn: load_model_for_file.bind(this),
                                   pre_fn: function() {
                                       map.set_status('Loading model ...');
                                   },
                                   failure_fn: function() {
                                       map.set_status('');
                                   } }
                        })
                .button({ id: 'convert_map',
                          key: keys.convert_map,
                          text: 'Update names and gene reaction rules using model' })
                .button({ id: 'clear_model',
                          key: keys.clear_model,
                          text: 'Clear model' });
        // disable the clear and convert buttons
        var disable_model_clear_convert = function() {
            model_menu.dropdown.selectAll('li')
                .classed('escher-disabled', function(d) {
                    if ((d.id == 'clear_model' || d.id == 'convert_map') &&
                        this.cobra_model === null)
                        return true;
                    return null;
                }.bind(this));
        }.bind(this);
        disable_model_clear_convert();
        this.callback_manager.set('load_model', disable_model_clear_convert);

        // data dropdown
        var data_menu = ui.dropdown_menu(menu, 'Data')
                .button({ input: { assign: key_manager.assigned_keys.load_reaction_data,
                                   key: 'fn',
                                   fn: load_reaction_data_for_file.bind(this),
                                   accept_csv: true,
                                   pre_fn: function() {
                                       map.set_status('Loading reaction data ...');
                                   },
                                   failure_fn: function() {
                                       map.set_status('');
                                   }},
                          text: 'Load reaction data' })
                .button({ key: keys.clear_reaction_data,
                          text: 'Clear reaction data' })
                .divider()
                .button({ input: { fn: load_gene_data_for_file.bind(this),
                                   accept_csv: true,
                                   pre_fn: function() {
                                       map.set_status('Loading gene data ...');
                                   },
                                   failure_fn: function() {
                                       map.set_status('');
                                   }},
                          text: 'Load gene data' })
                .button({ key: keys.clear_gene_data,
                          text: 'Clear gene data' })
                .divider()
                .button({ input: { fn: load_metabolite_data_for_file.bind(this),
                                   accept_csv: true,
                                   pre_fn: function() {
                                       map.set_status('Loading metabolite data ...');
                                   },
                                   failure_fn: function() {
                                       map.set_status('');
                                   }},
                          text: 'Load metabolite data' })
                .button({ key: keys.clear_metabolite_data,
                          text: 'Clear metabolite data' });

        // update the buttons
        var disable_clears = function() {
            data_menu.dropdown.selectAll('li')
                .classed('escher-disabled', function(d) {
                    if (!d) return null;
                    if (d.text == 'Clear reaction data' && this.options.reaction_data === null)
                        return true;
                    if (d.text == 'Clear gene data' && this.options.gene_data === null)
                        return true;
                    if (d.text == 'Clear metabolite data' && this.options.metabolite_data === null)
                        return true;
                    return null;
                }.bind(this));
        }.bind(this);
        disable_clears();
        this.callback_manager.set('update_data', disable_clears);

        // edit dropdown
        var edit_menu = ui.dropdown_menu(menu, 'Edit', true);
        if (enable_editing) {
            edit_menu
                .button({ key: keys.zoom_mode,
                          id: 'zoom-mode-menu-button',
                          text: 'Pan mode',
                          key_text: (enable_keys ? ' (Z)' : null) })
                .button({ key: keys.brush_mode,
                          id: 'brush-mode-menu-button',
                          text: 'Select mode',
                          key_text: (enable_keys ? ' (V)' : null) })
                .button({ key: keys.build_mode,
                          id: 'build-mode-menu-button',
                          text: 'Add reaction mode',
                          key_text: (enable_keys ? ' (N)' : null) })
                .button({ key: keys.rotate_mode,
                          id: 'rotate-mode-menu-button',
                          text: 'Rotate mode',
                          key_text: (enable_keys ? ' (R)' : null) })
                .button({ key: keys.text_mode,
                          id: 'text-mode-menu-button',
                          text: 'Text mode',
                          key_text: (enable_keys ? ' (T)' : null) })
                .divider()
                .button({ key: keys.delete,
                          text: 'Delete',
                          key_text: (enable_keys ? ' (Del)' : null) })
                .button({ key: keys.undo,
                          text: 'Undo',
                          key_text: (enable_keys ? ' (Ctrl+Z)' : null) })
                .button({ key: keys.redo,
                          text: 'Redo',
                          key_text: (enable_keys ? ' (Ctrl+Shift+Z)' : null) })
                .button({ key: keys.toggle_primary,
                          text: 'Toggle primary/secondary',
                          key_text: (enable_keys ? ' (P)' : null) })
                .button({ key: keys.cycle_primary,
                          text: 'Rotate reactant locations',
                          key_text: (enable_keys ? ' (C)' : null) })
                .button({ key: keys.select_all,
                          text: 'Select all',
                          key_text: (enable_keys ? ' (Ctrl+A)' : null) })
                .button({ key: keys.select_none,
                          text: 'Select none',
                          key_text: (enable_keys ? ' (Ctrl+Shift+A)' : null) })
                .button({ key: keys.invert_selection,
                          text: 'Invert selection' });
        } else {
            edit_menu.button({ key: keys.view_mode,
                               id: 'view-mode-menu-button',
                               text: 'View mode' });
        }

        // view dropdown
        var view_menu = ui.dropdown_menu(menu, 'View', true)
                .button({ key: keys.zoom_in,
                          text: 'Zoom in',
                          key_text: (enable_keys ? ' (Ctrl and +)' : null) })
                .button({ key: keys.zoom_out,
                          text: 'Zoom out',
                          key_text: (enable_keys ? ' (Ctrl and -)' : null) })
                .button({ key: keys.extent_nodes,
                          text: 'Zoom to nodes',
                          key_text: (enable_keys ? ' (Ctrl+0)' : null) })
                .button({ key: keys.extent_canvas,
                          text: 'Zoom to canvas',
                          key_text: (enable_keys ? ' (Ctrl+1)' : null) })
                .button({ key: keys.search,
                          text: 'Find',
                          key_text: (enable_keys ? ' (Ctrl+F)' : null) });
        if (full_screen_button){
            view_menu.button({key: keys.full_screen,
                text: 'Full screen',
                key_text: (enable_keys ? ' (Ctrl+2)' : null)});
        }
        if (enable_editing) {
            view_menu.button({ key: keys.toggle_beziers,
                               id: 'bezier-button',
                               text: 'Show control points',
                               key_text: (enable_keys ? ' (B)' : null) });
            map.callback_manager
                .set('toggle_beziers.button', function(on_off) {
                    menu.select('#bezier-button').select('.dropdown-button-text')
                        .text((on_off ? 'Hide' : 'Show') +
                              ' control points' +
                              (enable_keys ? ' (B)' : ''));
                });
        }
        view_menu.divider()
            .button({ key: keys.show_settings,
                      text: 'Settings',
                      key_text: (enable_keys ? ' (Ctrl+,)' : null) });

        // help
        menu.append('a')
            .attr('class', 'help-button')
            .attr('target', '#')
            .attr('href', 'https://escher.readthedocs.org')
            .text('?');

        var button_panel = button_selection.append('ul')
                .attr('class', 'nav nav-pills nav-stacked')
                .attr('id', 'button-panel');

        // buttons
        ui.individual_button(button_panel.append('li'),
                             { key: keys.zoom_in,
                               icon: 'glyphicon glyphicon-plus-sign',
                               classes: 'btn btn-default',
                               tooltip: 'Zoom in',
                               key_text: (enable_keys ? ' (Ctrl and +)' : null) });
        ui.individual_button(button_panel.append('li'),
                             { key: keys.zoom_out,
                               icon: 'glyphicon glyphicon-minus-sign',
                               classes: 'btn btn-default',
                               tooltip: 'Zoom out',
                               key_text: (enable_keys ? ' (Ctrl and -)' : null) });
        ui.individual_button(button_panel.append('li'),
                             { key: keys.extent_canvas,
                               icon: 'glyphicon glyphicon-resize-full',
                               classes: 'btn btn-default',
                               tooltip: 'Zoom to canvas',
                               key_text: (enable_keys ? ' (Ctrl+1)' : null) });
        if (full_screen_button) {
            ui.individual_button(button_panel.append('li'),
                {   key: keys.full_screen,
                    icon: 'glyphicon glyphicon-fullscreen',
                    classes: 'btn btn-default',
                    tooltip: 'Full screen',
                    key_text: (enable_keys ? ' (Ctrl+2)' : null)
                });
        }
        // mode buttons
        if (enable_editing) {
            ui.radio_button_group(button_panel.append('li'))
                .button({ key: keys.zoom_mode,
                          id: 'zoom-mode-button',
                          icon: 'glyphicon glyphicon-move',
                          tooltip: 'Pan mode',
                          key_text: (enable_keys ? ' (Z)' : null) })
                .button({ key: keys.brush_mode,
                          id: 'brush-mode-button',
                          icon: 'glyphicon glyphicon-hand-up',
                          tooltip: 'Select mode',
                          key_text: (enable_keys ? ' (V)' : null) })
                .button({ key: keys.build_mode,
                          id: 'build-mode-button',
                          icon: 'glyphicon glyphicon-plus',
                          tooltip: 'Add reaction mode',
                          key_text: (enable_keys ? ' (N)' : null) })
                .button({ key: keys.rotate_mode,
                          id: 'rotate-mode-button',
                          icon: 'glyphicon glyphicon-repeat',
                          tooltip: 'Rotate mode',
                          key_text: (enable_keys ? ' (R)' : null) })
                .button({ key: keys.text_mode,
                          id: 'text-mode-button',
                          icon: 'glyphicon glyphicon-font',
                          tooltip: 'Text mode',
                          key_text: (enable_keys ? ' (T)' : null) });

            // arrow buttons
            this.direction_buttons = button_panel.append('li');
            var o = ui.button_group(this.direction_buttons)
                    .button({ key: keys.direction_arrow_left,
                              icon: 'glyphicon glyphicon-arrow-left',
                              tooltip: 'Direction arrow (←)' })
                    .button({ key: keys.direction_arrow_right,
                              icon: 'glyphicon glyphicon-arrow-right',
                              tooltip: 'Direction arrow (→)' })
                    .button({ key: keys.direction_arrow_up,
                              icon: 'glyphicon glyphicon-arrow-up',
                              tooltip: 'Direction arrow (↑)' })
                    .button({ key: keys.direction_arrow_down,
                              icon: 'glyphicon glyphicon-arrow-down',
                              tooltip: 'Direction arrow (↓)' });
        }

        // set up mode callbacks
        var select_button = function(id) {
            // toggle the button
            $(this.selection.node()).find('#' + id)
                .button('toggle');

            // menu buttons
            var ids = ['zoom-mode-menu-button', 'brush-mode-menu-button',
                       'build-mode-menu-button', 'rotate-mode-menu-button',
                       'view-mode-menu-button', 'text-mode-menu-button'];
            ids.forEach(function(this_id) {
                var b_id = this_id.replace('-menu', '');
                this.selection.select('#' + this_id)
                    .select('span')
                    .classed('glyphicon', b_id == id)
                    .classed('glyphicon-ok', b_id == id);
            }.bind(this));
        };
        this.callback_manager.set('zoom_mode', select_button.bind(this, 'zoom-mode-button'));
        this.callback_manager.set('brush_mode', select_button.bind(this, 'brush-mode-button'));
        this.callback_manager.set('build_mode', select_button.bind(this, 'build-mode-button'));
        this.callback_manager.set('rotate_mode', select_button.bind(this, 'rotate-mode-button'));
        this.callback_manager.set('view_mode', select_button.bind(this, 'view-mode-button'));
        this.callback_manager.set('text_mode', select_button.bind(this, 'text-mode-button'));

        // definitions
        function load_map_for_file(error, map_data) {
            /** Load a map. This reloads the whole builder.

             */

            if (error) {
                console.warn(error);
                this.map.set_status('Error loading map: ' + error, 2000);
                return;
            }

            try {
                check_map(map_data);
                this.load_map(map_data);
                this.map.set_status('Loaded map ' + map_data[0].map_name, 3000);
            } catch (e) {
                console.warn(e);
                this.map.set_status('Error loading map: ' + e, 2000);
            }

            // definitions
            function check_map(data) {
                /** Perform a quick check to make sure the map is mostly valid.

                 */

                if (!('map_id' in data[0] && 'reactions' in data[1] &&
                      'nodes' in data[1] && 'canvas' in data[1]))
                    throw new Error('Bad map data.');
            }
        }
        function load_model_for_file(error, data) {
            /** Load a cobra model. Redraws the whole map if the
             highlight_missing option is true.

             */
            if (error) {
                console.warn(error);
                this.map.set_status('Error loading model: ' + error, 2000);
                return;
            }

            try {
                this.load_model(data, true);
                this.build_input.toggle(false);
                if ('id' in data)
                    this.map.set_status('Loaded model ' + data.id, 3000);
                else
                    this.map.set_status('Loaded model (no model id)', 3000);
            } catch (e) {
                console.warn(e);
                this.map.set_status('Error loading model: ' + e, 2000);
            }

        }
        function load_reaction_data_for_file(error, data) {
            if (error) {
                console.warn(error);
                this.map.set_status('Could not parse file as JSON or CSV', 2000);
                return;
            }
            // turn off gene data
            if (data !== null)
                this.set_gene_data(null);

            this.set_reaction_data(data);
        }
        function load_metabolite_data_for_file(error, data) {
            if (error) {
                console.warn(error);
                this.map.set_status('Could not parse file as JSON or CSV', 2000);
                return;
            }
            this.set_metabolite_data(data);
        }
        function load_gene_data_for_file(error, data) {
            if (error) {
                console.warn(error);
                this.map.set_status('Could not parse file as JSON or CSV', 2000);
                return;
            }
            // turn off reaction data
            if (data !== null)
                this.set_reaction_data(null);

            // turn on gene_reaction_rules
            this.settings.set_conditional('show_gene_reaction_rules', true);

            this.set_gene_data(data);
        }
    }

    function _setup_simple_zoom_buttons(button_selection, keys, full_screen_button) {
        var button_panel = button_selection.append('div')
                .attr('id', 'simple-button-panel');

        // buttons
        ui.individual_button(button_panel.append('div'),
                             { key: keys.zoom_in,
                               text: '+',
                               classes: 'simple-button',
                               tooltip: 'Zoom in (Ctrl +)' });
        ui.individual_button(button_panel.append('div'),
                             { key: keys.zoom_out,
                               text: '–',
                               classes: 'simple-button',
                               tooltip: 'Zoom out (Ctrl -)' });
        ui.individual_button(button_panel.append('div'),
                             { key: keys.extent_canvas,
                               text: '↔',
                               classes: 'simple-button',
                               tooltip: 'Zoom to canvas (Ctrl 1)' });
        if (full_screen_button) {
            ui.individual_button(button_panel.append('div'),
                {
                    key: keys.full_screen,
                    icon: 'glyphicon glyphicon-fullscreen',
                    classes: 'simple-button',
                    tooltip: 'Full screen (Ctrl 2)'
                });
        }
    }

    function _toggle_direction_buttons(on_off) {
        if (on_off===undefined)
            on_off = !this.direction_buttons.style('visibility')=='visible';
        this.direction_buttons.style('visibility', on_off ? 'visible' : 'hidden');
    }

    function _setup_status(selection, map) {
        var status_bar = selection.append('div').attr('id', 'status');
        map.callback_manager.set('set_status', function(status) {
            status_bar.html(status);
        });
        return status_bar;
    }

    function _setup_quick_jump(selection) {
        // function to load a map
        var load_fn = function(new_map_name, quick_jump_path, callback) {
            if (this.options.enable_editing && !this.options.never_ask_before_quit) {
                if (!(confirm(('You will lose any unsaved changes.\n\n' +
                               'Are you sure you want to switch maps?')))) {
                    if (callback) callback(false);
                    return;
                }
            }
            this.map.set_status('Loading map ' + new_map_name + ' ...');
            var url = utils.name_to_url(new_map_name, quick_jump_path);
            d3.json(url, function(error, data) {
                if (error) {
                    console.warn('Could not load data: ' + error);
                    if (callback) callback(false);
                }
                // run callback before load_map so the new map has the correct
                // quick_jump menu
                if (callback) callback(true);
                // now reload
                this.load_map(data);
                this.map.set_status('');
            }.bind(this));
        }.bind(this);

        // make the quick jump object
        this.quick_jump = QuickJump(selection, load_fn);
    }

    function _setup_modes(map, brush, zoom_container) {
        // set up zoom+pan and brush modes
        var was_enabled = {};
        map.callback_manager.set('start_rotation', function() {
            was_enabled.brush = brush.enabled;
            brush.toggle(false);
            was_enabled.zoom = zoom_container.zoom_on;
            zoom_container.toggle_pan_drag(false);
            was_enabled.selectable_mousedown = map.behavior.selectable_mousedown!=null;
            map.behavior.toggle_selectable_click(false);
            was_enabled.label_mousedown = map.behavior.label_mousedown!=null;
            map.behavior.toggle_label_mousedown(false);
        });
        map.callback_manager.set('end_rotation', function() {
            brush.toggle(was_enabled.brush);
            zoom_container.toggle_pan_drag(was_enabled.zoom);
            map.behavior.toggle_selectable_click(was_enabled.selectable_mousedown);
            map.behavior.toggle_label_mousedown(was_enabled.label_mousedown);
            was_enabled = {};
        });
    }

    function _get_keys(map, zoom_container, search_bar, settings_bar, enable_editing, full_screen_button) {
        var keys = {
            save: { key: 83, modifiers: { control: true }, // ctrl-s
                    target: map,
                    fn: map.save },
            save_svg: { key: 83, modifiers: { control: true, shift: true },
                        target: map,
                        fn: map.save_svg },
            load: { key: 79, modifiers: { control: true }, // ctrl-o
                    fn: null }, // defined by button
            convert_map: { fn: this.map.convert_map.bind(this.map) },
            clear_map: { fn: this.map.clear_map.bind(this.map) },
            load_model: { key: 77, modifiers: { control: true }, // ctrl-m
                          fn: null }, // defined by button
            clear_model: { fn: this.load_model.bind(this, null, true) },
            load_reaction_data: { fn: null }, // defined by button
            clear_reaction_data: { target: this,
                                   fn: function() { this.set_reaction_data(null); }},
            load_metabolite_data: { fn: null }, // defined by button
            clear_metabolite_data: { target: this,
                                     fn: function() { this.set_metabolite_data(null); }},
            load_gene_data: { fn: null }, // defined by button
            clear_gene_data: { fn: function() {
                this.set_gene_data(null, true);
            }.bind(this)},
            zoom_in: { key: 187, modifiers: { control: true }, // ctrl +
                       target: zoom_container,
                       fn: zoom_container.zoom_in },
            zoom_out: { key: 189, modifiers: { control: true }, // ctrl -
                        target: zoom_container,
                        fn: zoom_container.zoom_out },
            extent_nodes: { key: 48, modifiers: { control: true }, // ctrl-0
                            target: map,
                            fn: map.zoom_extent_nodes },
            extent_canvas: { key: 49, modifiers: { control: true }, // ctrl-1
                             target: map,
                             fn: map.zoom_extent_canvas },
            search: { key: 70, modifiers: { control: true }, // ctrl-f
                      fn: search_bar.toggle.bind(search_bar, true) },
            view_mode: { fn: this.view_mode.bind(this),
                         ignore_with_input: true },
            show_settings: { key: 188, modifiers: { control: true }, // Ctrl ,
                             fn: settings_bar.toggle.bind(settings_bar) }
        };
        if (full_screen_button){
            utils.extend(keys, {
                    full_screen: { key: 50, modifiers: { control: true }, // ctrl-2
                                   target: map,
                                   fn: map.full_screen }});
        }
        if (enable_editing) {
            utils.extend(keys, {
                build_mode: { key: 78, // n
                              fn: this.build_mode.bind(this),
                              ignore_with_input: true },
                zoom_mode: { key: 90, // z
                             fn: this.zoom_mode.bind(this),
                             ignore_with_input: true },
                brush_mode: { key: 86, // v
                              fn: this.brush_mode.bind(this),
                              ignore_with_input: true },
                rotate_mode: { key: 82, // r
                               fn: this.rotate_mode.bind(this),
                               ignore_with_input: true },
                text_mode: { key: 84, // t
                             fn: this.text_mode.bind(this),
                             ignore_with_input: true },
                toggle_beziers: { key: 66,
                                  target: map,
                                  fn: map.toggle_beziers,
                                  ignore_with_input: true  }, // b
                delete: { key: 8, modifiers: { control: true }, // ctrl-backspace
                          target: map,
                          fn: map.delete_selected,
                          ignore_with_input: true },
                delete_del: { key: 46, modifiers: { control: false }, // Del
                              target: map,
                              fn: map.delete_selected,
                              ignore_with_input: true },
                toggle_primary: { key: 80, // p
                                  target: map,
                                  fn: map.toggle_selected_node_primary,
                                  ignore_with_input: true },
                cycle_primary: { key: 67, // c
                                 target: map,
                                 fn: map.cycle_primary_node,
                                 ignore_with_input: true },
                direction_arrow_right: { key: 39, // right
                                         fn: this.build_input.direction_arrow.right
                                         .bind(this.build_input.direction_arrow),
                                         ignore_with_input: true },
                direction_arrow_down: { key: 40, // down
                                        fn: this.build_input.direction_arrow.down
                                        .bind(this.build_input.direction_arrow),
                                        ignore_with_input: true },
                direction_arrow_left: { key: 37, // left
                                        fn: this.build_input.direction_arrow.left
                                        .bind(this.build_input.direction_arrow),
                                        ignore_with_input: true },
                direction_arrow_up: { key: 38, // up
                                      fn: this.build_input.direction_arrow.up
                                      .bind(this.build_input.direction_arrow),
                                      ignore_with_input: true },
                undo: { key: 90, modifiers: { control: true },
                        target: map.undo_stack,
                        fn: map.undo_stack.undo },
                redo: { key: 90, modifiers: { control: true, shift: true },
                        target: map.undo_stack,
                        fn: map.undo_stack.redo },
                select_all: { key: 65, modifiers: { control: true }, // Ctrl Shift a
                              fn: map.select_all.bind(map) },
                select_none: { key: 65, modifiers: { control: true, shift: true }, // Ctrl Shift a
                               fn: map.select_none.bind(map) },
                invert_selection: { fn: map.invert_selection.bind(map) }
            });
        }
        return keys;
    }

    function _setup_confirm_before_exit() {
        /** Ask if the user wants to exit the page (to avoid unplanned refresh).

         */

        window.onbeforeunload = function(e) {
            // If we haven't been passed the event get the window.event
            e = e || window.event;
            return  (this.options.never_ask_before_quit ? null :
                     'You will lose any unsaved changes.');
        }.bind(this);
    }
});
