define(["lib/d3"], function(d3) {
    // private
    var height_width_style = function(selection, margins) {
        var width = parseFloat(selection.style('width')) - margins.left - margins.right,
            height = parseFloat(selection.style('height')) - margins.top - margins.bottom;
        return {'width': width, 'height': height};
    };
    var height_width_attr = function(selection, margins) {
        var width = parseFloat(selection.attr('width')) - margins.left - margins.right,
            height = parseFloat(selection.attr('height')) - margins.top - margins.bottom;
        return {'width': width, 'height': height};
    };

    // public
    var set_options = function(options, defaults) {
        var i = -1,
            out = defaults,
            keys = window.Object.keys(options);
        while (++i < keys.length) out[keys[i]] = options[keys[i]];
        return out;
    };
    var setup_svg = function(selection, selection_is_svg, margins, fill_screen) {
        // sub selection places the graph in an existing svg environment
        var add_svg = function(f, s, m) {
            if (f) {
		d3.select("body")
		    .style("margin", "0")
		    .style("padding", "0");
                s.style('height', (window.innerHeight-m.top)+'px');
                s.style('width', (window.innerWidth-m.left)+'px');
		s.style("margin-left", m.left+"px");
		s.style("margin-top", m.top+"px");
            }
            var out = height_width_style(s, m);
            out.svg = s.append('svg')
                .attr("width", out.width)
                .attr("height", out.height)
                .attr('xmlns', "http://www.w3.org/2000/svg");
            return out;
        };

        // run
        var out;
        if (selection_is_svg) {
            out = height_width_attr(selection, margins);
            out.svg = selection;
        } else if (selection) {
            out = add_svg(fill_screen, selection, margins);
        } else {
            out = add_svg(fill_screen, d3.select('body').append('div'), margins);
        }
	if (out.height <= 0 || out.width <= 0) {
	    console.warn("Container has invalid height or \
width. Try setting styles for height \
and width, or use the 'fill_screen' option.");
	}
        return out;
    };

    var resize_svg = function(selection, selection_is_svg, margins, fill_screen) {
        // returns null
        var resize = function(f, s, m) {
            if (f) {
                s.style('height', (window.innerHeight-margins.bottom)+'px');
                s.style('width', (window.innerWidth-margins.right)+'px');
            }
            var out = height_width_style(f, s, margins);
            out.svg = s.select('svg')
                .attr("width", out.width + m.left + m.right)
                .attr("height", out.height + m.top + m.bottom)
                .attr('xmlns', "http://www.w3.org/2000/svg");
            return out;
        };

        var out;
        if (selection_is_svg) {
            out = height_width_attr(selection, margins);
            out.svg = selection;
        } else if (selection) {
            out = resize(fill_screen, selection, margins);
        } else {
            out = resize(fill_screen, d3.select('body').append('div'), margins);
        }
        return out;
    };

    var load_css = function(css_path, callback) {
        var css = "";
        if (css_path) {
            d3.text(css_path, function(error, text) {
                if (error) {
                    console.warn(error);
                }
                css = text;
                callback(css);
            });
        }
        return false;
    };
    var update = function () {
        return 'omg yes';
    };
    var load_the_file = function(file, callback) { 
	if (!file) {
	    callback("No filename", null, file);
	    return;
	}
        if (ends_with(file, 'json')) d3.json(file, function(e, d) { callback(e, d, file); });
        else if (ends_with(file, 'css')) d3.text(file, function(e, d) { callback(e, d, file); });
        else callback("Unrecognized file type", null, file);
	return; 

	// definitions
	function ends_with(str, suffix) { return str.indexOf(suffix, str.length - suffix.length) !== -1; }
    };
    var load_files = function(files_to_load, final_callback) {
        // load multiple files asynchronously
        // Takes a list of objects: { file: a_filename.json, callback: a_callback_fn }
        var i = -1, remaining = files_to_load.length, callbacks = {};
        while (++i < files_to_load.length) {
            var this_file = files_to_load[i].file;
            callbacks[this_file] = files_to_load[i].callback;
            load_the_file(this_file,
                          function(e, d, file) {
                              callbacks[file](e, d);
                              if (!--remaining) final_callback();
                          });
        }
    };
    return {
        set_options: set_options,
        setup_svg: setup_svg,
        load_css: load_css,
        load_files: load_files
    };
});
